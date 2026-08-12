import { requireEnv } from "../config.ts";
import { PROVIDER_TIMEOUT_MS, RETRY_DELAY_MS } from "../timeouts.ts";
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
  model: string;
  prompt: string;
  schema: unknown;
  maxOutputTokens: number;
}

/**
 * One Gemini call. NEVER throws — every failure becomes a ProviderOutcome so
 * §5.2's fail-closed path has something to fail closed on.
 */
async function call(opts: CallOpts, attempt = 1): Promise<ProviderOutcome> {
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
      // See timeouts.ts — this must stay BELOW the client abort, or the app
      // gives up before our typed 503 can reach it.
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    status = res.status;
    raw = await res.json();
  } catch (err) {
    const name = (err as Error)?.name;
    const failure: ProviderFailure = name === "TimeoutError" || name === "AbortError" ? "timeout" : "transport";
    // Retry ONCE, blind. Gemini documents no Retry-After and no retryDelay
    // (§5.6), and retries consume RPD too — burning the daily budget guessing
    // at backoff is a bad trade.
    if (attempt === 1) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return call(opts, 2);
    }
    return { ok: false, failure, detail: `${name}: ${(err as Error)?.message ?? ""}` };
  }

  if (status === 429) {
    return { ok: false, failure: "quota", detail: "429 RESOURCE_EXHAUSTED", raw };
  }
  if (status !== 200) {
    return { ok: false, failure: "http", detail: `HTTP ${status}`, raw };
  }
  return parseGeminiBody(raw);
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
        model: GEMINI_CLASSIFY_MODEL,
        prompt: buildRouterPrompt(req.question, req.language, req.index),
        schema: ROUTER_SCHEMA,
        maxOutputTokens: 2048,
      });
    },

    answer(req: AnswerRequest): Promise<ProviderOutcome> {
      return call({
        model: GEMINI_ANSWER_MODEL,
        prompt: buildAnswerPrompt(req.question, req.language, req.entries),
        schema: ANSWER_SCHEMA,
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
