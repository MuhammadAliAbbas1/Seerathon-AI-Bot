import { getEntry } from "./corpus.ts";
import { buildPromptEntries, entryTextForCitation, entryTitle } from "./entry-text.ts";
import { route } from "./router.ts";
import * as S from "./strings.ts";
import type { Language, Mode } from "./types.ts";
import type { LlmProvider, ProviderOutcome } from "./providers/types.ts";

/**
 * The headless core (§5.1). Takes a question, returns structured JSON. Knows
 * nothing about HTTP, and nothing about which provider is behind the adapter.
 */

export interface Citation {
  id: string;
  type: "shamail" | "timeline";
  title: string;
  text: string;
}

export interface AskSuccess {
  ok: true;
  mode: Mode;
  language: Language;
  answer: string;
  citations: Citation[];
  /** Diagnostic. Never rendered. */
  reason: string;
}

export interface AskFailure {
  ok: false;
  /** Failures are a different shape, not a fourth mode (§5.4). */
  code: "quota_exhausted" | "provider_unavailable";
  language: Language;
  message: string;
  retryAfterSeconds: number;
  /** Diagnostic only. Logged server-side, NEVER sent over the wire. */
  reason?: string;
}

export type AskResult = AskSuccess | AskFailure;

/**
 * Route reasons that mean "our call broke", not "the corpus has nothing".
 *
 * The router fails closed to out_of_corpus for all of these — correct, because
 * it must never fail toward answering — but the USER-FACING text has to be
 * honest about which happened (§5.6). `keyword-ratchet`, `model` and
 * `no-valid-candidates` are genuine outcomes and keep the fallback copy.
 */
const SYSTEM_FAILURE_REASONS = new Set([
  "provider-quota",
  "provider-timeout",
  "provider-transport",
  "provider-http",
  "model-blocked",
  "model-empty",
  "model-malformed",
  "model-off-enum",
]);

export interface AskOptions {
  provider: LlmProvider;
  /** Client hint. The server may override from detected language (§5.4). */
  languageHint?: Language;
  /** Accepted and deliberately ignored for now — see §8 and the note below. */
  history?: unknown;
}

function refusal(mode: Mode, language: Language, reason: string): AskSuccess {
  return {
    ok: true,
    mode,
    language,
    // FIXED copy, never model output. This is why refusals survive quota
    // exhaustion, safety blocks and provider outages.
    answer: mode === "ruling_seeking" ? S.RULING_SEEKING[language] : S.OUT_OF_CORPUS[language],
    citations: [],
    reason,
  };
}

/**
 * §5.3 — the key safety mechanism, applied to what the model claims it used.
 *
 * All three checks, on EVERY citation. Any failure, or zero citations, discards
 * the whole answer. We never repair, never partially render, and never strip a
 * bad citation and show the rest: an answer with the evidence removed is worse
 * than no answer.
 */
function validateCitations(raw: unknown, language: Language): Citation[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const id of raw) {
    if (typeof id !== "string") return null;
    if (seen.has(id)) continue;
    seen.add(id);

    const entry = getEntry(id); // check 1: the id exists
    if (!entry) return null;
    if (!entry.hasBody[language]) return null; // checks 2 + 3: body, in this language

    const text = entryTextForCitation(entry, language);
    if (!text) return null; // defence in depth: hasBody said yes but nothing rendered

    out.push({
      // EVERY field is read from the cache after validation, never copied from
      // the model's output — the model supplies an id and nothing else (§5.4).
      id,
      type: entry.type,
      title: entryTitle(entry, language),
      text,
    });
  }
  return out.length > 0 ? out : null;
}

export async function ask(question: string, opts: AskOptions): Promise<AskResult> {
  // ── 1. Route first, always (§5.2) ─────────────────────────────────────────
  const routed = await route(question, { provider: opts.provider });
  const language = routed.language;

  // The router fails closed to out_of_corpus on a SYSTEM failure as well as on
  // a genuine classification. Those two must not produce the same user-facing
  // text: telling someone "I could not find anything in the collection" when we
  // were actually rate-limited is precisely the lie §5.6 forbids. Surface the
  // system failures as failures.
  if (SYSTEM_FAILURE_REASONS.has(routed.reason)) {
    const quota = routed.reason === "provider-quota";
    return {
      ok: false,
      code: quota ? "quota_exhausted" : "provider_unavailable",
      language,
      message: quota ? S.QUOTA_EXHAUSTED[language] : S.SERVICE_ERROR[language],
      retryAfterSeconds: quota ? 30 : 10,
      reason: `route:${routed.reason}${routed.detail ? ` ${routed.detail}` : ""}`,
    };
  }

  // Refusals cost ZERO further requests — three of the four rubric behaviours
  // never touch the answering model at all.
  if (routed.mode !== "in_corpus") {
    return refusal(routed.mode, language, routed.reason);
  }

  // ── 2. Assemble grounding material from the CACHE ─────────────────────────
  const entries = buildPromptEntries(routed.candidateIds, language);
  if (entries.length === 0) {
    return refusal("out_of_corpus", language, "no-usable-entries");
  }

  // ── 3. Generate ───────────────────────────────────────────────────────────
  let outcome: ProviderOutcome;
  try {
    outcome = await opts.provider.answer({ question, language, entries });
  } catch (err) {
    if ((err as Error)?.name === "MissingFixtureError") throw err;
    return {
      ok: false, code: "provider_unavailable", language,
      message: S.SERVICE_ERROR[language], retryAfterSeconds: 10,
      reason: `answer:threw ${(err as Error)?.name ?? "Error"}`,
    };
  }

  if (!outcome.ok) {
    // A system failure must never degrade into answering (§5.6). Quota and
    // outage are reported honestly; they are NOT turned into a fallback that
    // looks like a considered refusal.
    if (outcome.failure === "quota") {
      return {
        ok: false, code: "quota_exhausted", language,
        message: S.QUOTA_EXHAUSTED[language], retryAfterSeconds: 30,
        reason: outcome.detail ?? "answer:quota",
      };
    }
    // Everything else — blocked (including `recitation`), truncated JSON,
    // timeout, transport — is a SYSTEM failure, and is reported as one.
    //
    // It would be easy to fall through to the out_of_corpus copy here and look
    // graceful. That copy says "I could not find anything in the collection
    // that covers this", which in these cases is FALSE: the router found the
    // material, and we failed to render it. Telling a user the corpus lacks
    // something when our own generation broke is a small lie in a system whose
    // entire value is not saying things it cannot stand behind.
    return {
      ok: false, code: "provider_unavailable", language,
      message: S.SERVICE_ERROR[language], retryAfterSeconds: 10,
      reason: outcome.detail ?? `answer:${outcome.failure}`,
    };
  }

  // ── 4. Validate before anything reaches the user ──────────────────────────
  const data = outcome.data as Record<string, unknown> | null;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return refusal("out_of_corpus", language, "answer-malformed");
  }

  const answer = typeof data.answer === "string" ? data.answer.trim() : "";
  const citations = validateCitations(data.citations, language);

  // Never trust the model's self-reported citations. No citations, or any bad
  // one, and the answer is discarded entirely.
  if (!answer || !citations) {
    return refusal("out_of_corpus", language, citations ? "answer-empty" : "citations-invalid");
  }

  return { ok: true, mode: "in_corpus", language, answer, citations, reason: routed.reason };
}
