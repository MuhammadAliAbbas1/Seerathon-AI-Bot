/**
 * The curated demo-cache question set (CLAUDE.md §5.6) — ONE source of truth,
 * read by the recorder (which spends quota) and the builder (which cannot).
 *
 * Two scripts hand-typing the same list is a drift generator; that already
 * happened once between `tests/adversarial.md` and its runner, and cost a case
 * that sat green without ever being tested.
 *
 * ── Why exactly these ──────────────────────────────────────────────────────
 *
 * The landing screen's example chips, plus the one question a judge is most
 * likely to type unprompted.
 *
 * ⚠️ The four visible chips are SIX distinct questions. A chip sends its text
 * in the SHELL language, so flipping the UR/EN toggle changes what it sends:
 * an English shell sends three English chips and one Urdu, an Urdu shell sends
 * the mirror. The union is six.
 *
 * Two of those six trip the ruling ratchet, which refuses with zero model
 * calls and returns instantly (§5.5). They are marked below and skipped by the
 * builder — caching them would add entries that do nothing.
 *
 * ── Why it stops here ──────────────────────────────────────────────────────
 *
 * There are 37 recorded fixtures in `api/fixtures/` covering the whole
 * adversarial suite, and allowlisting them would cost nothing.
 *
 * We deliberately do not. The distinction is between what we INVITE and what a
 * judge CHOOSES: the chips are our invitation, so pre-seeding them is demo
 * preparation, while the adversarial questions are what a judge thinks of
 * themselves and are the actual test. Those must reach the live system, or a
 * pass proves nothing about the deployment in their hands.
 */

export interface DemoQuestion {
  label: string;
  question: string;
  /** True where the ruling ratchet fires — no model call, so nothing to cache. */
  ratchetOnly?: true;
  /** Where the text comes from, so a reworded chip is traceable. */
  source: "chip" | "typed";
}

export const DEMO_QUESTIONS: DemoQuestion[] = [
  // ── Chips. Must match mobile/src/strings.ts; `npm run shell:check` asserts it.
  { label: "chip in-corpus EN", source: "chip", question: "What was the Prophet's ﷺ character like?" },
  { label: "chip in-corpus UR", source: "chip", question: "حضور ﷺ کا اخلاق کیسا تھا؟" },
  { label: "chip out-of-corpus EN", source: "chip", question: "What did the Prophet ﷺ think about cryptocurrency?" },
  { label: "chip out-of-corpus UR", source: "chip", question: "کیا حضور ﷺ کرپٹو کرنسی کے بارے میں کچھ فرماتے ہیں؟" },
  { label: "chip ruling EN", source: "chip", question: "Is it sunnah to eat with the right hand?", ratchetOnly: true },
  { label: "chip ruling UR", source: "chip", question: "کیا دائیں ہاتھ سے کھانا سنت ہے؟", ratchetOnly: true },

  // ── The most likely unprompted question anyone asks a Shamail bot.
  { label: "typed appearance EN", source: "typed", question: "What did the Prophet ﷺ look like?" },
  { label: "typed appearance UR", source: "typed", question: "حضور ﷺ کا حلیہ مبارک کیسا تھا؟" },
];

/** The subset the cache actually holds — everything the ratchet does not already refuse. */
export const CACHEABLE = DEMO_QUESTIONS.filter((q) => !q.ratchetOnly);
