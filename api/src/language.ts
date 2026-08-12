import type { DetectedLanguage, Language } from "./types.ts";

/** Arabic, Arabic Supplement, Extended-A, and the presentation-form blocks. */
function isArabicScript(cp: number): boolean {
  return (
    (cp >= 0x0600 && cp <= 0x06ff) ||
    (cp >= 0x0750 && cp <= 0x077f) ||
    (cp >= 0x08a0 && cp <= 0x08ff) ||
    (cp >= 0xfb50 && cp <= 0xfdff) ||
    (cp >= 0xfe70 && cp <= 0xfeff)
  );
}

/**
 * Roman-Urdu function words. Deliberately *function* words (pronouns,
 * postpositions, auxiliaries) rather than topic words: they appear in almost
 * every Urdu sentence regardless of subject, and they are rare as standalone
 * English words. Topic words like "prophet" or "namaz" would fire on English
 * questions about Urdu subjects, which is exactly the wrong direction.
 *
 * Spelling is not enumerable — kya/kia/kea, hai/hy/he, chahiye/chahiye/chahye —
 * so this is a *signal*, never a gate. Missing a spelling costs us nothing
 * except a question routed to the English block.
 */
/**
 * STRONG — effectively never standalone English words. One of these is real
 * evidence.
 */
const STRONG = new Set([
  "kya", "kia", "kea", "kyaa", "kiya",
  "kaise", "kese", "kaisa", "kaisi", "kyun", "kyu",
  "chahiye", "chahiy", "chahye",
  "huzoor", "huzur", "nabi", "akhlaq", "sunnat", "hadees", "seerat",
  "nahi", "nahin", "hain", "unka", "unki", "aap",
  "hota", "hoti", "karna", "karta", "bataye", "batao", "jaiz",
]);

/**
 * WEAK — Urdu function words that also occur, or nearly occur, in English.
 * Never sufficient alone.
 *
 * `he` and `men` were originally in this list as spellings of `hai` and
 * `mein`. They are removed on purpose: they are among the most common English
 * words, and the offline suite caught them routing "When was he born?" to the
 * Urdu block. A marker that fires on ordinary English costs us the language of
 * the whole answer, which is a worse failure than missing a spelling variant.
 */
const WEAK = new Set([
  "hai", "hay", "hy",
  "tha", "thi", "thay",
  "ka", "ki", "ke", "ko", "se", "mein", "par", "aur", "bhi", "ye", "yeh",
]);

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

export function words(text: string): string[] {
  return text.toLowerCase().normalize("NFC").split(WORD_SPLIT).filter(Boolean);
}

/**
 * Detect the question's language.
 *
 * Script is checked first and wins outright — Arabic-script text is Urdu, full
 * stop. Otherwise we look for roman-Urdu function words. Everything else is
 * English.
 */
export function detectLanguage(question: string): DetectedLanguage {
  const q = question.normalize("NFC");

  let arabic = 0;
  let latin = 0;
  for (const ch of q) {
    const cp = ch.codePointAt(0)!;
    if (isArabicScript(cp)) arabic++;
    else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) latin++;
  }

  // Any meaningful amount of Arabic script means Urdu. A stray ﷺ or a quoted
  // Arabic phrase inside an English sentence should NOT flip the language, so
  // require it to be a real share of the letters rather than merely present.
  if (arabic > 0 && arabic >= latin) return "ur";

  const ws = words(q);
  let strong = 0;
  let weak = 0;
  for (const w of ws) {
    if (STRONG.has(w)) strong++;
    else if (WEAK.has(w)) weak++;
  }

  // Corroboration, not any single hit. A lone weak marker in an English
  // sentence is a coincidence; a lone strong one might be a loanword.
  if (strong >= 2 || (strong >= 1 && weak >= 1) || weak >= 3) return "roman-ur";

  return "en";
}

/**
 * Which corpus block feeds the prompt and the citations.
 *
 * Roman-Urdu maps to `ur`: the user is asking in Urdu, and the Urdu block is
 * what we can actually cite (§7.1). Whether the *answer* comes back in Urdu
 * script or roman-Urdu is a separate open question — §7.1 leans Urdu script,
 * since that is what the corpus contains.
 */
export function answerLanguage(detected: DetectedLanguage): Language {
  return detected === "en" ? "en" : "ur";
}
