import type { Language } from "./types.ts";

/**
 * FIXED, LOCALIZED COPY.
 *
 * Every non-answer path the user can reach is a constant, never model output.
 * Three of the four rubric behaviours are refusals (§2), so this file — not the
 * model — is what a judge will actually read most of the time. It is also what
 * keeps the refusals immune to quota exhaustion, safety blocks and provider
 * outages: none of these strings needs an API call.
 *
 * They are written to sound like a careful person, not a system message. No
 * error codes, no "I am an AI language model", no apology theatre.
 *
 * ⚠️ URDU COPY NEEDS A NATIVE-SPEAKER REVIEW before the demo. It is
 * grammatical and I believe it reads naturally, but tone in a religious
 * register is exactly the thing a non-native writer gets subtly wrong, and
 * §7.1 makes these strings user-facing on three of the four rubric items.
 */

type Localized = Record<Language, string>;

/** mode = out_of_corpus. The corpus does not cover it; say so, do not guess. */
export const OUT_OF_CORPUS: Localized = {
  en: "I can only answer from the approved Seerah and Shamail collection, and I could not find anything in it that covers this. I would rather tell you that than guess.",
  ur: "میں صرف منظور شدہ سیرت و شمائل کے ذخیرے سے جواب دے سکتا ہوں، اور اس میں مجھے اس سوال سے متعلق کچھ نہیں ملا۔ اندازہ لگانے سے بہتر ہے کہ میں یہ صاف عرض کر دوں۔",
};

/** mode = ruling_seeking. Refuse, and hand the person somewhere better. */
export const RULING_SEEKING: Localized = {
  en: "This is a question about a religious ruling, and it is not something I should answer. Please put it to a qualified scholar — an alim can weigh your circumstances properly, which I cannot.",
  // "اس کا جواب دینا میرا کام نہیں" ("it is not my role") was accurate but flat
  // for this register. Humility reads better than job description here: the
  // point is that I am not QUALIFIED, not that it falls outside my duties.
  ur: "یہ شرعی حکم سے متعلق سوال ہے، اور میں اس کا جواب دینے کا اہل نہیں ہوں۔ براہِ کرم کسی مستند عالم سے رجوع فرمائیے — وہ آپ کے حالات کو صحیح طور پر پرکھ سکتے ہیں، جو میں نہیں کر سکتا۔",
};

/**
 * The answer path produced something we could not verify — a citation failed
 * §5.3, or the model returned none. The user gets the same honest fallback as
 * out_of_corpus rather than an unsourced answer.
 */
export const UNVERIFIED_ANSWER: Localized = OUT_OF_CORPUS;

/** HTTP 503, code = quota_exhausted. */
export const QUOTA_EXHAUSTED: Localized = {
  en: "The service is briefly at capacity. Please try again in a moment.",
  ur: "اس وقت سروس پر دباؤ ہے۔ براہِ کرم ایک لمحے بعد دوبارہ کوشش کیجیے۔",
};

/** HTTP 503, code = provider_unavailable or blocked. */
export const SERVICE_ERROR: Localized = {
  en: "Something went wrong at my end. Please try again in a moment.",
  ur: "میری طرف سے کوئی خرابی پیش آ گئی ہے۔ براہِ کرم ایک لمحے بعد دوبارہ کوشش کیجیے۔",
};

/**
 * The short, human, persistently-visible disclaimer (§4).
 *
 * NOT the /meta string — that one is written at the bot builder ("Cite every
 * answer with source id and title…") and reads as a leaked system prompt if
 * shown in chat. The verbatim /meta text goes on the About screen instead.
 * Both are required; neither substitutes for the other.
 */
export const DISCLAIMER: Localized = {
  en: "Answers come only from an approved Seerah and Shamail collection, and each one shows its source. This is not a source of religious rulings.",
  ur: "جوابات صرف منظور شدہ سیرت و شمائل کے ذخیرے سے آتے ہیں، اور ہر جواب اپنا حوالہ ساتھ دکھاتا ہے۔ یہ شرعی احکام کا ذریعہ نہیں۔",
};

export function pick(s: Localized, language: Language): string {
  return s[language];
}
