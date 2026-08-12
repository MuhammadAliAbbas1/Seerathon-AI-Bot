/**
 * PRODUCTION ENTRYPOINT. Vercel captures a `server.{ts,js}` at the project
 * root that calls listen() at module startup, and routes requests to it.
 *
 * ── Why there is no framework here ────────────────────────────────────────
 *
 * §5.1 put ~80% of the work in a headless core, and handleAsk() is already a
 * pure function of (body, provider) → {status, body}. What remains is: parse a
 * URL, read a body, check a rate limit, write JSON. Hono or Express would each
 * add a runtime dependency (§9 says ask first) to save perhaps fifteen lines
 * of node:http, while adding a version to track, a security surface, and one
 * more thing that can differ between local and deployed. It does not earn its
 * place. If this ever grows real routing, middleware, or auth, revisit — none
 * of those are on the roadmap (§8).
 *
 * Deliberately separate from api/scripts/dev-server.ts: that one defaults to
 * fixtures so building UI costs zero quota, and prints LAN hints and recorded
 * questions. This one is live, rate limited, and says nothing it doesn't have
 * to. They share the part that matters — handleAsk().
 */
import { createServer } from "node:http";
import { handleAsk } from "./api/src/http.ts";
import { createGeminiProvider } from "./api/src/providers/gemini.ts";
import { createOpenRouterProvider } from "./api/src/providers/openrouter.ts";
import { loadCorpus } from "./api/src/corpus.ts";
import { configSource, providerId, readEnv } from "./api/src/config.ts";
import { checkRateLimit, clientIp } from "./api/src/rate-limit.ts";
import { answerLanguage, detectLanguage } from "./api/src/language.ts";
import { QUOTA_EXHAUSTED } from "./api/src/strings.ts";
import { CLIENT_TIMEOUT_MS, FUNCTION_MAX_DURATION_S, PROVIDER_TIMEOUT_MS } from "./api/src/timeouts.ts";

// No fixture layer in production: a deployed backend answers questions, it
// does not replay a test corpus. (§5.6's pre-seeded demo cache is a separate,
// deliberate Phase 7 artifact and is not this.)
const provider = providerId() === "openrouter" ? createOpenRouterProvider() : createGeminiProvider();

// Touch the corpus at module scope so a bad bake fails at boot, in the build
// logs, rather than on a judge's first question.
const corpus = loadCorpus();

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST,GET,OPTIONS",
};

const json = (res: import("node:http").ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS).end();
    return;
  }

  const path = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;

  if (req.method === "GET" && (path === "/api/health" || path === "/")) {
    json(res, 200, {
      ok: true,
      // §5.4: the project cannot be derived from the key, so label it and
      // check the label before demoing.
      deployEnv: readEnv("DEPLOY_ENV") ?? "unset",
      provider: providerId(),
      // Which of the two config sources is live. Reported because "the key is
      // set" is exactly the thing that is easy to assume and expensive to be
      // wrong about — see api/src/config.ts.
      configSource: configSource(),
      // Presence only. The value never leaves the server.
      geminiKey: readEnv("GEMINI_API_KEY") ? "present" : "MISSING",
      openrouterKey: readEnv("OPENROUTER_API_KEY") ? "present" : "MISSING",
      corpusVersion: corpus.corpusVersion,
      entries: corpus.counts.total,
      timeouts: {
        providerMs: PROVIDER_TIMEOUT_MS,
        clientMs: CLIENT_TIMEOUT_MS,
        functionMaxS: FUNCTION_MAX_DURATION_S,
      },
    });
    return;
  }

  if (req.method !== "POST" || path !== "/api/ask") {
    json(res, 404, { error: { code: "invalid_request", message: "not found" } });
    return;
  }

  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    json(res, 400, { error: { code: "invalid_request", message: "body must be JSON" } });
    return;
  }

  // ── Rate limit AFTER parsing, deliberately ────────────────────────────────
  // It costs nothing in safety: parsing a body is trivial, and no provider
  // call can happen before this gate either way — protecting the LLM quota is
  // the limiter's entire job (§5.4). What it buys is the language, so the
  // refusal can be written in the language the user asked in. §7.1 requires
  // the whole shell localized, and an English "too many requests" on an Urdu
  // question is exactly the visible seam that section exists to prevent.
  const ip = clientIp(req.headers);
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    const q = typeof (parsed as Record<string, unknown>)?.question === "string"
      ? ((parsed as Record<string, unknown>).question as string)
      : "";
    const language = answerLanguage(detectLanguage(q));
    console.log(`  429  rate limit (${limit.reason})  ${ip}`);
    json(res, 429, {
      error: {
        // Distinct from quota_exhausted on purpose: this is OUR limiter, not
        // Gemini's. Same calm copy at the surface, different cause in the log.
        code: "rate_limited",
        message: QUOTA_EXHAUSTED[language],
        retryAfterSeconds: limit.retryAfterSeconds,
      },
    });
    return;
  }

  const started = Date.now();
  try {
    const out = await handleAsk(parsed, provider);
    console.log(`  ${out.status}  ${Date.now() - started}ms  ${ip}`);
    json(res, out.status, out.body);
  } catch (err) {
    // handleAsk is built not to throw (§5.2) — every provider failure is an
    // outcome, not an exception. If one escapes anyway it is a bug in us, and
    // it still must not reach the user as a crash: an unhandled 500 on stage
    // is indistinguishable from the process dying.
    console.error("unhandled error in /api/ask:", err);
    json(res, 503, {
      error: { code: "provider_unavailable", message: "The service is briefly unavailable.", retryAfterSeconds: 10 },
    });
  }
});

// Vercel detects the HTTP server from this call. The port is only meaningful
// when running the file locally; it is not exposed publicly on Vercel.
server.listen(Number(process.env.PORT ?? readEnv("PORT") ?? 8787), () => {
  console.log(
    `Seerathon API up — provider=${providerId()} config=${configSource()} ` +
      `corpus=${corpus.corpusVersion} entries=${corpus.counts.total} env=${readEnv("DEPLOY_ENV") ?? "unset"}`
  );
});
