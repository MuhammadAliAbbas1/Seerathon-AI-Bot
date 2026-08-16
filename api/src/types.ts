// Shared vocabulary. Kept deliberately small — see CLAUDE.md §5.6 on not
// building a generic LLM abstraction.

// Mode and Language are defined ONCE, in contract.ts, because they cross the
// wire and the app must agree with us. Re-exported so existing imports of
// ./types.ts keep working.
export type { Citation, Language, Mode } from "./contract.ts";
import type { Language, Mode } from "./contract.ts";

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
  /**
   * The provider's own account of what went wrong — op, model, attempt,
   * elapsed, budget. Diagnostic only: logged server-side, never sent over the
   * wire and never shown to a user.
   */
  detail?: string;
  /** The classification came from the demo cache rather than a live call (§5.6). */
  fromCache?: boolean;
}
