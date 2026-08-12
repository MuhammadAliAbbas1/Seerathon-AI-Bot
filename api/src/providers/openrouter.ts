import { requireEnv } from "../config.ts";
import { ANSWER_SCHEMA, ROUTER_SCHEMA, buildAnswerPrompt, buildRouterPrompt } from "../prompts.ts";
import type {
  AnswerRequest,
  ClassifyRequest,
  LlmProvider,
  ProviderFailure,
  ProviderOutcome,
} from "./types.ts";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * INSURANCE ONLY — see §5.6. We build and validate against Gemini; this is
 * verified once and then left alone.
 *
 * Switching here means shipping a router that has never been validated on the
 * model actually serving it: the fixtures hold Gemini's responses, so a green
 * suite proves nothing about this provider. That is the stated cost of pulling
 * the lever, and it is why there is NO automatic failover.
 *
 * One model for both roles: OpenRouter's free daily allowance is a shared pool,
 * not per-model, so splitting roles buys nothing.
 */
export const OPENROUTER_MODEL = "google/gemma-4-26b-a4b-it:free";

async function call(prompt: string, maxTokens: number, attempt = 1, schema: unknown = ROUTER_SCHEMA): Promise<ProviderOutcome> {
  const key = requireEnv("OPENROUTER_API_KEY");
  const body = {
    model: OPENROUTER_MODEL,
    messages: [{ role: "user", content: prompt }],
    max_tokens: maxTokens,
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: { name: "result", strict: true, schema },
    },
  };

  let raw: unknown;
  let status: number;
  try {
    // Same rule as the Gemini client: the response read is inside the try, so
    // an abort mid-body is caught by this retry rather than escaping it.
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    status = res.status;
    raw = await res.json();
  } catch (err) {
    const name = (err as Error)?.name;
    const failure: ProviderFailure = name === "TimeoutError" || name === "AbortError" ? "timeout" : "transport";
    if (attempt === 1) {
      await new Promise((r) => setTimeout(r, 1500));
      return call(prompt, maxTokens, 2, schema);
    }
    return { ok: false, failure, detail: `${name}: ${(err as Error)?.message ?? ""}` };
  }

  if (status === 429) return { ok: false, failure: "quota", detail: "429 rate limited", raw };
  if (status === 404) {
    // The :free roster rotates and endpoints are delisted without notice
    // (§5.6). Treat this as "pick a new fallback", not "the fallback is broken".
    return { ok: false, failure: "http", detail: `404 — ${OPENROUTER_MODEL} may have been delisted`, raw };
  }
  if (status !== 200) return { ok: false, failure: "http", detail: `HTTP ${status}`, raw };

  return parseOpenRouterBody(raw);
}

/** Exported so the offline suite can drive it directly. */
export function parseOpenRouterBody(raw: unknown): ProviderOutcome {
  const body = raw as any;
  const choices = body?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return { ok: false, failure: "empty", detail: "no choices returned", raw };
  }
  const finish = choices[0]?.finish_reason;
  if (finish === "content_filter") {
    return { ok: false, failure: "blocked", detail: "finish_reason=content_filter", raw };
  }
  const text = choices[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, failure: "empty", detail: `empty content (finish_reason=${finish ?? "none"})`, raw };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, failure: "malformed", detail: `unparseable JSON (finish_reason=${finish ?? "none"})`, raw };
  }
  return { ok: true, data, raw };
}

export function createOpenRouterProvider(): LlmProvider {
  return {
    id: "openrouter",
    classifyModel: OPENROUTER_MODEL,
    answerModel: OPENROUTER_MODEL,
    classify(req: ClassifyRequest): Promise<ProviderOutcome> {
      return call(buildRouterPrompt(req.question, req.language, req.index), 2048);
    },
    answer(req: AnswerRequest): Promise<ProviderOutcome> {
      return call(buildAnswerPrompt(req.question, req.language, req.entries), 8192, 1, ANSWER_SCHEMA);
    },
  };
}
