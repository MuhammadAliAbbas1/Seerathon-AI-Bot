import { requireEnv } from "../config.ts";
import { ANSWER_THINKING_BUDGET, ANSWER_TIMEOUT_MS, RETRY_DELAY_MS, ROUTER_TIMEOUT_MS } from "../timeouts.ts";
import { ANSWER_SCHEMA, ROUTER_SCHEMA, buildAnswerPrompt, buildRouterPrompt } from "../prompts.ts";
import type {
  AnswerRequest,
  ClassifyRequest,
  LlmProvider,
  ProviderFailure,
  ProviderOutcome,
} from "./types.ts";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Verified callable on project 268175794480 (§5.6). Both stable — no preview
 * model on the demo path. Availability is PROJECT-SCOPED and GET /models lies
 * about it, so these were confirmed by calling, not by listing.
 */
export const GEMINI_CLASSIFY_MODEL = "gemini-2.5-flash-lite";
export const GEMINI_ANSWER_MODEL = "gemini-2.5-flash";

/** Generation-block reasons. `recitation` is a live risk for us specifically (§5.4). */
const BLOCK_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "LANGUAGE",
  "IMAGE_SAFETY",
  "OTHER",
]);

interface CallOpts {
  /** "classify" | "answer" — decides the timeout, and labels the log line. */
  op: string;
  model: string;
  prompt: string;
  schema: unknown;
  maxOutputTokens: number;
  timeoutMs: number;
  /**
   * Gemini thinking budget, in tokens. 0 disables thinking; range 0–24576.
   * Omitted means "leave the model's default alone".
   */
  thinkingBudget?: number;
}

/**
 * One Gemini call. NEVER throws — every failure becomes a ProviderOutcome so
 * §5.2's fail-closed path has something to fail closed on.
 */
async function call(opts: CallOpts, attempt = 1): Promise<ProviderOutcome> {
  const startedAt = Date.now();
  const key = requireEnv("GEMINI_API_KEY");
  const body = {
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: opts.schema,
      // Generous on purpose: gemini-2.5-flash is a thinking model and thinking
      // consumes the output budget. A tight cap truncates the JSON mid-object,
      // which is the MAX_TOKENS case the offline suite covers.
      maxOutputTokens: opts.maxOutputTokens,
      temperature: 0,
      ...(opts.thinkingBudget === undefined
        ? {}
        : { thinkingConfig: { thinkingBudget: opts.thinkingBudget } }),
    },
  };

  let raw: unknown;
  let status: number;
  try {
    // ── The whole read sits inside the try, not just fetch(). ──────────────
    // An abort can fire while the body is still streaming; with res.json()
    // outside, that timeout escapes the retry entirely. This killed a
    // corpus:sync run (§5.6 client rule).
    const res = await fetch(`${BASE}/${opts.model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      // Per-OP timeout (timeouts.ts). The router and the answer model differ
      // by more than an order of magnitude; one shared constant is what broke
      // the answer path on 2026-08-12.
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    status = res.status;
    raw = await res.json();
  } catch (err) {
    const name = (err as Error)?.name;
    const timedOut = name === "TimeoutError" || name === "AbortError";
    const failure: ProviderFailure = timedOut ? "timeout" : "transport";
    const elapsed = Date.now() - startedAt;
    log(opts, attempt, elapsed, failure);

    // ── Retry TRANSPORT errors. NEVER retry a timeout. ────────────────────
    //
    // A transport error — refused connection, DNS, a dropped socket — is a
    // property of the moment, fails fast, and often succeeds on a second try.
    //
    // A timeout is not. It means the model needed more time than we allowed,
    // and retrying grants it exactly the same budget, so it fails identically.
    // The cost is not zero either: Gemini still processes and bills the
    // abandoned request, so a retry buys a second charge, a second slot
    // against the rate limit, and double the time to a failure that was
    // already certain. Worse than useless.
    //
    // This is why the 2026-08-12 incident took 34.8s instead of 18s, and why
    // it spent two answer requests to return one error.
    if (attempt === 1 && !timedOut) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return call(opts, 2);
    }
    return {
      ok: false,
      failure,
      detail: `${opts.op}:${failure} model=${opts.model} attempt=${attempt} elapsed=${elapsed}ms budget=${opts.timeoutMs}ms`,
    };
  }

  const elapsed = Date.now() - startedAt;

  if (status === 429) {
    log(opts, attempt, elapsed, "quota");
    return { ok: false, failure: "quota", detail: `${opts.op}:quota 429 RESOURCE_EXHAUSTED elapsed=${elapsed}ms`, raw };
  }
  if (status !== 200) {
    log(opts, attempt, elapsed, `http-${status}`);
    return { ok: false, failure: "http", detail: `${opts.op}:http HTTP ${status} elapsed=${elapsed}ms`, raw };
  }

  const parsed = parseGeminiBody(raw);
  log(opts, attempt, elapsed, parsed.ok ? "ok" : parsed.failure, usageOf(raw));
  return parsed;
}

/**
 * One line per provider call, server-side only.
 *
 * The 2026-08-12 incident needed a full log-and-arithmetic reconstruction to
 * establish something the process itself knew at the time: which call failed,
 * why, and how long it had. A system whose whole value is not saying things it
 * cannot stand behind should not need forensics to explain its own failure —
 * so it now names its own cause.
 *
 * Deliberately never includes the question or the answer: this lands in
 * Vercel's logs, and the corpus is religious content people ask about
 * personally.
 */
function log(opts: CallOpts, attempt: number, elapsedMs: number, result: string, usage = ""): void {
  console.log(
    `  [gemini] ${opts.op} model=${opts.model} attempt=${attempt} ` +
      `elapsed=${elapsedMs}ms budget=${opts.timeoutMs}ms -> ${result}${usage}`
  );
}

/** Token counts make answer latency explicable rather than mysterious. */
function usageOf(raw: unknown): string {
  const u = (raw as any)?.usageMetadata;
  if (!u) return "";
  const thoughts = u.thoughtsTokenCount ?? 0;
  return ` tokens(prompt=${u.promptTokenCount ?? "?"} out=${u.candidatesTokenCount ?? "?"} thoughts=${thoughts})`;
}

/** Exported so the offline suite can drive it with hand-written envelopes. */
export function parseGeminiBody(raw: unknown): ProviderOutcome {
  const body = raw as any;

  // The prompt itself was blocked — no candidates will exist at all.
  const blockReason = body?.promptFeedback?.blockReason;
  if (blockReason) {
    return { ok: false, failure: "blocked", detail: `promptFeedback.blockReason=${blockReason}`, raw };
  }

  const candidates = body?.candidates;
  // "The content that was blocked is not returned" — so candidates can be
  // empty. Check before indexing (§5.6).
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { ok: false, failure: "empty", detail: "no candidates returned", raw };
  }

  const c0 = candidates[0];
  const finish = typeof c0?.finishReason === "string" ? c0.finishReason.toUpperCase() : "";
  if (BLOCK_REASONS.has(finish)) {
    return { ok: false, failure: "blocked", detail: `finishReason=${finish}`, raw };
  }

  const parts = c0?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((p: any) => p?.text ?? "").join("") : "";
  if (!text.trim()) {
    // MAX_TOKENS with no text at all: the whole budget went to thinking.
    return { ok: false, failure: "empty", detail: `empty text (finishReason=${finish || "none"})`, raw };
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // Truncated mid-object is the common shape here, and finishReason tells us
    // why — worth keeping in the detail so a fixture is self-explaining.
    return { ok: false, failure: "malformed", detail: `unparseable JSON (finishReason=${finish || "none"})`, raw };
  }
  return { ok: true, data, raw };
}

export function createGeminiProvider(): LlmProvider {
  return {
    id: "gemini",
    classifyModel: GEMINI_CLASSIFY_MODEL,
    answerModel: GEMINI_ANSWER_MODEL,

    classify(req: ClassifyRequest): Promise<ProviderOutcome> {
      return call({
        op: "classify",
        model: GEMINI_CLASSIFY_MODEL,
        prompt: buildRouterPrompt(req.question, req.language, req.index),
        schema: ROUTER_SCHEMA,
        maxOutputTokens: 2048,
        timeoutMs: ROUTER_TIMEOUT_MS,
        // Deliberately UNSET. gemini-2.5-flash-lite has thinking OFF by
        // default, and all 15 recorded classify fixtures confirm it —
        // thoughtsTokenCount is 0 on every one. The router therefore already
        // makes its judgment (mode, precedence, candidates, language) without
        // thinking, in 1.3–2.6s. Setting a budget here would TURN THINKING ON
        // and slow down the one call that is currently fast.
      });
    },

    answer(req: AnswerRequest): Promise<ProviderOutcome> {
      return call({
        op: "answer",
        model: GEMINI_ANSWER_MODEL,
        prompt: buildAnswerPrompt(req.question, req.language, req.entries),
        schema: ANSWER_SCHEMA,
        timeoutMs: ANSWER_TIMEOUT_MS,
        // ── Thinking OFF. See ANSWER_THINKING_BUDGET for the measurements. ──
        thinkingBudget: ANSWER_THINKING_BUDGET,
        // Sized generously ON PURPOSE. gemini-2.5-flash is a thinking model and
        // thinking is charged against the output budget — we have already
        // observed a 16-token cap produce finishReason=MAX_TOKENS on a
        // two-character reply. A tight limit here truncates the JSON
        // mid-object, which surfaces as `malformed` and discards a perfectly
        // good answer.
        maxOutputTokens: 8192,
      });
    },
  };
}
