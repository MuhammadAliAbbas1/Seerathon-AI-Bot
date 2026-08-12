/**
 * Local dev server for POST /api/ask. Run: npm run dev:api
 *
 * Zero dependencies (node:http) — adopting Hono is still an open decision
 * (§9), and the core is framework-agnostic on purpose (§5.1), so this is a
 * thin shell over the same handleAsk() that production will call.
 *
 * DEFAULTS TO FIXTURES. A question with no recorded fixture returns 503
 * rather than silently spending quota — developing the UI must cost nothing.
 * Pass --live to allow real calls.
 */
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { networkInterfaces } from "node:os";
import { handleAsk } from "../src/http.ts";
import { createGeminiProvider } from "../src/providers/gemini.ts";
import { createOpenRouterProvider } from "../src/providers/openrouter.ts";
import { withFixtures } from "../src/providers/fixtures.ts";
import { FIXTURE_DIR, MissingFixtureError } from "../src/providers/fixtures.ts";
import { loadCorpus } from "../src/corpus.ts";
import { providerId, readEnv } from "../src/config.ts";

const LIVE = process.argv.includes("--live");
const PORT = Number(readEnv("PORT") ?? 8787);

const base = providerId() === "openrouter" ? createOpenRouterProvider() : createGeminiProvider();
const provider = withFixtures(base, LIVE ? undefined : "off");

const corpus = loadCorpus();

const server = createServer(async (req, res) => {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST,GET,OPTIONS",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors).end();
    return;
  }

  if (req.method === "GET" && req.url === "/api/health") {
    res.writeHead(200, { ...cors, "content-type": "application/json" }).end(
      JSON.stringify({
        ok: true,
        // §5.4: the project cannot be derived from the key, so label it and
        // check the label before demoing.
        deployEnv: readEnv("DEPLOY_ENV") ?? "unset",
        provider: providerId(),
        mode: LIVE ? "LIVE (spends quota)" : "fixtures only",
        corpusVersion: corpus.corpusVersion,
        entries: corpus.counts.total,
      })
    );
    return;
  }

  if (req.method !== "POST" || req.url !== "/api/ask") {
    res.writeHead(404, { ...cors, "content-type": "application/json" }).end(
      JSON.stringify({ error: { code: "not_found" } })
    );
    return;
  }

  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    res.writeHead(400, { ...cors, "content-type": "application/json" }).end(
      JSON.stringify({ error: { code: "invalid_request", message: "body must be JSON" } })
    );
    return;
  }

  const started = Date.now();
  try {
    const out = await handleAsk(parsed, provider);
    console.log(`  ${out.status}  ${Date.now() - started}ms  ${JSON.stringify((parsed as any).question ?? "").slice(0, 60)}`);
    res.writeHead(out.status, { ...cors, "content-type": "application/json" }).end(JSON.stringify(out.body));
  } catch (err) {
    if (err instanceof MissingFixtureError) {
      // Deliberate: an unrecorded question in fixture mode is a 503, not a
      // live call. Developing the UI must never spend quota by accident.
      console.log(`  503  no fixture — ${JSON.stringify((parsed as any).question ?? "").slice(0, 60)}`);
      res.writeHead(503, { ...cors, "content-type": "application/json" }).end(
        JSON.stringify({
          error: {
            code: "provider_unavailable",
            message: "No recorded fixture for that question. Run the batch to record it, or start with --live.",
            retryAfterSeconds: 0,
          },
        })
      );
      return;
    }
    console.error(err);
    res.writeHead(500, { ...cors, "content-type": "application/json" }).end(
      JSON.stringify({ error: { code: "provider_unavailable" } })
    );
  }
});

server.listen(PORT, () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((n) => n && n.family === "IPv4" && !n.internal)?.address;
  console.log(`\nSeerathon API — ${LIVE ? "[31mLIVE (spends quota)[0m" : "fixtures only, zero quota"}`);
  console.log(`  corpus ${corpus.corpusVersion}, ${corpus.counts.total} entries`);
  console.log(`  http://localhost:${PORT}/api/ask`);
  if (lan) console.log(`  http://${lan}:${PORT}/api/ask   ← use this on a real device`);
  console.log(`\n  recorded questions you can ask right now:`);
  for (const q of recordedQuestions()) console.log(`    · ${q}`);
  console.log();
});

function recordedQuestions(): string[] {
  const out = new Set<string>();
  for (const f of readdirSync(FIXTURE_DIR).filter((x) => x.endsWith(".json"))) {
    const j = JSON.parse(readFileSync(join(FIXTURE_DIR, f), "utf8"));
    if (j.meta?.question) out.add(j.meta.question);
  }
  return [...out];
}
