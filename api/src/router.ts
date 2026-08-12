import { filterCitable, loadCorpus } from "./corpus.ts";
import { answerLanguage, detectLanguage } from "./language.ts";
import { rulingRatchet } from "./ruling-keywords.ts";
import { isMode } from "./types.ts";
import type { Language, RouteReason, RouteResult } from "./types.ts";
import type { LlmProvider, ProviderOutcome } from "./providers/types.ts";

/**
 * THE GUARDRAIL ROUTER (CLAUDE.md §5.2).
 *
 * Runs FIRST, before any answer generation. Its contract:
 *
 *   - It NEVER throws. An unhandled exception on stage is indistinguishable
 *     from a crash, and the fallback path is the only one that will ever be
 *     exercised under pressure.
 *   - Anything unexpected lands on out_of_corpus. Not on in_corpus, ever.
 *   - ruling_seeking beats in_corpus, in code, not only in the prompt.
 *
 * Fail-closed here is not a safety net — it is THE guarantee, because Gemini's
 * responseSchema enum is explicitly not strictly enforced (§5.2, §5.6).
 */

/** Anything above this is padding; the answer path does not need more. */
const MAX_CANDIDATES = 5;

function refuse(language: Language, detected: RouteResult["detected"], reason: RouteReason): RouteResult {
  return { mode: "ruling_seeking", language, detected, candidateIds: [], reason };
}

function fallback(language: Language, detected: RouteResult["detected"], reason: RouteReason): RouteResult {
  return { mode: "out_of_corpus", language, detected, candidateIds: [], reason };
}

/** Maps a provider failure onto a reason. Every branch ends at out_of_corpus. */
function reasonForFailure(outcome: Extract<ProviderOutcome, { ok: false }>): RouteReason {
  switch (outcome.failure) {
    case "blocked":
      return "model-blocked";
    case "empty":
      return "model-empty";
    case "quota":
      return "provider-quota";
    case "timeout":
      return "provider-timeout";
    case "transport":
      return "provider-transport";
    case "malformed":
      return "model-malformed";
    default:
      return "provider-http";
  }
}

export interface RouteOptions {
  provider: LlmProvider;
  /** Override the routing index. Tests inject a small one. */
  index?: string;
}

export async function route(question: string, opts: RouteOptions): Promise<RouteResult> {
  const detected = detectLanguage(question ?? "");
  const language = answerLanguage(detected);

  // A blank question is not a corpus question. Costs nothing to check and
  // saves a request.
  if (typeof question !== "string" || !question.trim()) {
    return fallback(language, detected, "no-valid-candidates");
  }

  // ── 1. The one-way ratchet ────────────────────────────────────────────────
  // A HIT forces refusal and short-circuits without a model call: zero quota,
  // and §5.5 is explicit that a false refusal is a minor cost while a false
  // answer is a rubric failure.
  // A MISS proves nothing and falls through to the model. It must never be
  // read as "safe".
  if (rulingRatchet(question).hit) {
    return refuse(language, detected, "keyword-ratchet");
  }

  // ── 2. Ask the model ──────────────────────────────────────────────────────
  const index = opts.index ?? loadCorpus().index;
  let outcome: ProviderOutcome;
  try {
    outcome = await opts.provider.classify({ question, language, index });
  } catch (err) {
    // Providers are contracted not to throw, but the router must survive one
    // that does anyway — including MissingFixtureError, which should surface
    // as a test failure rather than as an answered question.
    if ((err as Error)?.name === "MissingFixtureError") throw err;
    return fallback(language, detected, "provider-transport");
  }

  if (!outcome.ok) {
    return fallback(language, detected, reasonForFailure(outcome));
  }

  // ── 3. Validate the shape in code ─────────────────────────────────────────
  const data = outcome.data as Record<string, unknown> | null;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return fallback(language, detected, "model-malformed");
  }

  // The load-bearing check. `enum` in responseSchema is advisory on Gemini.
  if (!isMode(data.mode)) {
    return fallback(language, detected, "model-off-enum");
  }

  // ── 4. Precedence, enforced in code ───────────────────────────────────────
  // Belt and braces with the prompt: if the model says ruling_seeking we
  // refuse, and we never carry candidates through a refusal (§5.4 — a
  // non-empty citations array on a refusal mode is a bug).
  if (data.mode === "ruling_seeking") {
    return refuse(language, detected, "model");
  }
  if (data.mode === "out_of_corpus") {
    return fallback(language, detected, "model");
  }

  // ── 5. in_corpus — candidates must survive validation ─────────────────────
  const rawIds = Array.isArray(data.candidateIds) ? data.candidateIds : [];
  // §5.3 checks 1–3: the id exists, the entry has a body, and that body is in
  // the language we are about to answer in.
  const valid = filterCitable(rawIds, language).slice(0, MAX_CANDIDATES);

  // A claimed in_corpus with nothing citable behind it is exactly the failure
  // §5.3 exists to prevent — the model has answered from its own knowledge and
  // attached a decorative reference. Fail closed rather than let the answer
  // path try.
  if (valid.length === 0) {
    return fallback(language, detected, "no-valid-candidates");
  }

  return { mode: "in_corpus", language, detected, candidateIds: valid, reason: "model" };
}
