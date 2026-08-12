import type { Language } from "../types.ts";

/**
 * Why a provider call did not yield usable JSON. Every one of these must land
 * on the safe fallback (§5.2) — none of them may reach the answer path.
 */
export type ProviderFailure =
  | "blocked" // safety / recitation / prohibited_content — content not returned
  | "empty" // 200 but no candidates
  | "quota" // 429 RESOURCE_EXHAUSTED
  | "timeout"
  | "transport" // DNS, connection reset, abort mid-body
  | "malformed" // response arrived but is not the JSON we asked for
  | "http"; // any other non-200

/**
 * A provider call NEVER throws and NEVER returns a partial. It returns one of
 * these two shapes, and the caller fails closed on the second.
 *
 * `raw` is the entire response envelope, kept so fixtures can replay failure
 * paths (finishReason, safetyRatings, usageMetadata) and not just happy ones.
 */
export type ProviderOutcome =
  | { ok: true; data: unknown; raw: unknown }
  | { ok: false; failure: ProviderFailure; detail: string; raw?: unknown };

export interface ClassifyRequest {
  question: string;
  /** The language block that feeds the prompt and that we will answer in. */
  language: Language;
  /** The full routing index — every entry, nothing excluded (§4B). */
  index: string;
}

export interface AnswerRequest {
  question: string;
  language: Language;
  /** Full text of the selected entries only. */
  entries: Array<{ id: string; title: string; body: string }>;
}

/**
 * Exactly two methods. Everything provider-specific lives behind them.
 *
 * Do NOT let this grow a `generate()`, streaming, tools, or embeddings — the
 * moment it does we have built a worse SDK (§5.6).
 */
export interface LlmProvider {
  readonly id: string;
  readonly classifyModel: string;
  readonly answerModel: string;
  classify(req: ClassifyRequest): Promise<ProviderOutcome>;
  answer(req: AnswerRequest): Promise<ProviderOutcome>;
}
