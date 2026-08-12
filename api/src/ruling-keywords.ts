import { words } from "./language.ts";

/**
 * THE ONE-WAY RATCHET (CLAUDE.md §5.5).
 *
 * This list may only ever escalate toward refusal. A hit forces
 * `ruling_seeking`. A MISS PROVES NOTHING and must never short-circuit to
 * "safe" — the model still classifies independently.
 *
 * That asymmetry is what makes the roman-Urdu spelling problem tolerable.
 * `jaiz / jaez / jayaz / jaayaz` × `kya / kia / kea` × `hai / hy / he` can never
 * be fully enumerated, but under a ratchet a missed spelling costs us nothing
 * we had: the question simply goes to the model, which is where it would have
 * gone anyway. Adding a spelling can only ever make us more cautious.
 *
 * Consequence worth stating plainly: a hit short-circuits WITHOUT a model call.
 * That is deliberate. It costs zero quota, and §5.5 is explicit that a false
 * refusal is a minor cost while a false answer is a rubric failure.
 */

/** Single tokens. Matched on word boundaries so "haram" does not fire on "haramain". */
const TOKENS = [
  // English / Islamic-legal vocabulary
  "halal", "haraam", "haram", "makruh", "makrooh", "mustahab", "wajib", "waajib",
  "fard", "farz", "sunnah", "sunnat", "fatwa", "fatwah", "hukm", "hukum", "shariah",
  "sharia", "shar'i", "impermissible", "permissible", "obligatory", "forbidden",
  "sinful", "gunah", "gunnah", "jaiz", "jaez", "jayaz", "jaayaz", "najaiz", "najaez",
  // Urdu script
  "جائز", "ناجائز", "حرام", "حلال", "واجب", "فرض", "مکروہ", "مستحب",
  "گناہ", "حکم", "فتویٰ", "فتوی", "شرعی", "شریعت", "سنت",
];

/** Multi-word phrases. Matched as substrings of the normalised question. */
const PHRASES = [
  // English
  "is it permissible", "is it allowed", "is it okay to", "is it ok to",
  "is it right to", "is it wrong to", "is it a sin", "is it sinful",
  "am i allowed", "are we allowed", "can i", "may i", "should i", "must i",
  "do i have to", "is one allowed", "is one permitted", "is it obligatory",
  "what is the ruling", "what does islam say", "what does shariah say",
  "is it compulsory", "is it necessary to",
  // Indirect framings — §5.5 requires these explicitly
  "my friend wants to know", "a friend asked", "asking for a friend",
  "hypothetically", "in general is it", "generally speaking is it",
  // Roman-Urdu
  "kya jaiz", "kya jaez", "kya jayaz", "jaiz hai", "jaez hai", "jayaz hai",
  "kya hukm", "kya hukum", "hukm hai", "kya karna chahiye", "karna chahiye",
  "chahiye ya nahi", "kya sunnat", "sunnat hai", "kya haram", "haram hai",
  "kya halal", "halal hai",
  // Urdu script
  "کیا جائز", "جائز ہے", "کیا حکم", "کیا کرنا چاہیے", "کرنا چاہیے",
  "کیا حرام", "کیا حلال", "شرعی حکم",
];

export interface RatchetResult {
  hit: boolean;
  /** Which pattern fired. Diagnostic only — never shown to a user. */
  matched: string[];
}

/**
 * Returns whether the question trips the ruling ratchet.
 *
 * NOTE the direction of the contract: `hit: true` means "definitely treat this
 * as ruling-seeking". `hit: false` means "no opinion" — NOT "safe".
 */
export function rulingRatchet(question: string): RatchetResult {
  const normalised = question.toLowerCase().normalize("NFC").replace(/\s+/g, " ").trim();
  const tokenSet = new Set(words(question));
  const matched: string[] = [];

  for (const t of TOKENS) {
    if (tokenSet.has(t.toLowerCase())) matched.push(t);
  }
  for (const p of PHRASES) {
    if (normalised.includes(p)) matched.push(p);
  }

  return { hit: matched.length > 0, matched };
}
