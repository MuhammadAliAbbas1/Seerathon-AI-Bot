// Shared vocabulary. Kept deliberately small — see CLAUDE.md §5.6 on not
// building a generic LLM abstraction.

/** The three-way classification. Nothing else is ever a valid mode. */
export type Mode = "in_corpus" | "out_of_corpus" | "ruling_seeking";

export const MODES = ["in_corpus", "out_of_corpus", "ruling_seeking"] as const;

/**
 * Gemini's responseSchema `enum` is NOT strictly enforced — the docs say the
 * model "is not guaranteed to strictly comply… always validate values in your
 * application" (§5.6). This function is therefore load-bearing, not a
 * formality: it is the only thing standing between an off-enum string and the
 * answer path.
 */
export function isMode(v: unknown): v is Mode {
  return typeof v === "string" && (MODES as readonly string[]).includes(v);
}

/** A language we can actually answer and cite in — the corpus has two blocks. */
export type Language = "en" | "ur";

/**
 * What the user appears to have typed. Roman-Urdu is a distinct *input* form
 * that maps onto the `ur` corpus block (§7.1) — script is not a reliable
 * language signal, so we keep the distinction rather than collapsing it.
 */
export type DetectedLanguage = "en" | "ur" | "roman-ur";

/** Why the router landed where it did. Diagnostic only — never shown to users. */
export type RouteReason =
  | "keyword-ratchet"
  | "model"
  | "model-off-enum"
  | "model-malformed"
  | "model-blocked"
  | "model-empty"
  | "provider-quota"
  | "provider-timeout"
  | "provider-transport"
  | "provider-http"
  | "no-valid-candidates";

export interface RouteResult {
  mode: Mode;
  /** The language this question will be ANSWERED in. Authoritative (§5.4). */
  language: Language;
  detected: DetectedLanguage;
  /** Always [] unless mode is in_corpus. Every id here exists and has a body. */
  candidateIds: string[];
  reason: RouteReason;
}
