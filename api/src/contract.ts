// ─────────────────────────────────────────────────────────────────────────────
//  SHARED CONTRACT — the wire shape of POST /api/ask (CLAUDE.md §5.4).
//
//  ⚠️  THIS FILE IS THE SOURCE OF TRUTH AND IS COPIED, NOT IMPORTED.
//
//  `npm run contract:sync` writes a generated copy to mobile/src/contract.ts.
//  Do not edit that copy — it is overwritten, and `npm run contract:check`
//  fails the build if the two have drifted.
//
//  Why copied rather than shared: we deliberately have no monorepo (Decision
//  3) — two sibling packages, no workspace linking, because EAS Build's
//  monorepo friction is a documented cost and the shared surface is this one
//  file. The trade was accepted knowingly; this script is the mitigation that
//  was promised at the time and, for three phases, not delivered. `Mode` was
//  in fact declared twice and nothing would have caught a rename.
// ─────────────────────────────────────────────────────────────────────────────

/** The three-way classification. Nothing else is ever a valid mode. */
export type Mode = "in_corpus" | "out_of_corpus" | "ruling_seeking";

/** A language we can answer and cite in — the corpus ships exactly two blocks. */
export type Language = "en" | "ur";

/**
 * Every field here is read from the baked corpus AFTER validation. The model
 * supplies an id and nothing else (§5.4), which is also what keeps verbatim
 * corpus text out of the model's output entirely (§5.4 recitation rule).
 */
export interface Citation {
  /** 24-char hex ObjectId. Never an integer — slugs are not unique. */
  id: string;
  type: "shamail" | "timeline";
  title: string;
  /** Body text, in the response `language`. Never mixed scripts. */
  text: string;
}

export interface AskRequest {
  question: string;
  /** Client hint only. The server may override from detected language (§7.1). */
  language?: Language;
  /** Accepted and currently ignored — the field exists so the wire shape
   *  never has to change after the APK ships (§8). */
  history?: unknown[];
}

/** HTTP 200. */
export interface AskResponseBody {
  mode: Mode;
  /** AUTHORITATIVE. The client renders direction and font from this, not
   *  from what it asked for. */
  language: Language;
  answer: string;
  /** Always [] for out_of_corpus and ruling_seeking. A non-empty array on a
   *  refusal mode is a bug. */
  citations: Citation[];
  /** Server-owned so the surface cannot forget to show it, and so the copy
   *  carrying three of four rubric behaviours has one source of truth. */
  disclaimer: string;
}

/**
 * HTTP 503 / 400. A failure is a different SHAPE, not a fourth mode: `mode`
 * describes the question, and quota or an outage describes the system (§5.4).
 */
export type ErrorCode =
  | "quota_exhausted"
  | "provider_unavailable"
  | "blocked"
  | "invalid_request";

export interface AskErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** Our estimate — Gemini documents no retry timing (§5.6). */
    retryAfterSeconds?: number;
  };
}
