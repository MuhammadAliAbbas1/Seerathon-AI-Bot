import type { Language } from "./api";

/**
 * SHELL copy only — labels, placeholders, screen titles.
 *
 * The answer-path strings (fallback, alim redirect, quota, error, disclaimer)
 * come from the SERVER, so there is exactly one source of truth for the
 * language a judge actually reads (§7.1). Do not duplicate them here.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 PENDING NATIVE-SPEAKER REVIEW — the Urdu below is written by the agent
 * and has NOT been checked for register. Owner is the human (§10, Phase 5).
 *
 * One call is explicitly open and should be decided first:
 *
 *   معذرت  (apology / "excuse me")  ← currently used in the chip tags
 *   انکار  (refusal / denial)       ← more literally accurate
 *
 * انکار is the correct translation of "declined" but reads harsh, and §12.2
 * requires a refusal to read as a courtesy rather than an error. معذرت is
 * softer but risks sounding like the bot is apologising for a fault, which
 * undersells a principled, designed refusal. Placeholder only — do not treat
 * its presence here as a decision.
 * ─────────────────────────────────────────────────────────────────────────
 */
type L = Record<Language, string>;

export const UI: Record<string, L> = {
  appTitle: { en: "Seerathon", ur: "سیرَتھون" },
  aboutTitle: { en: "About & Corpus Rules", ur: "تعارف اور اصولِ ذخیرہ" },
  placeholder: { en: "Ask about the Seerah or Shamail…", ur: "سیرت یا شمائل کے بارے میں پوچھیے…" },
  send: { en: "Ask", ur: "پوچھیں" },
  thinking: { en: "Looking through the collection…", ur: "ذخیرے میں تلاش کیا جا رہا ہے…" },
  sourcesOne: { en: "1 source", ur: "۱ حوالہ" },
  sourcesMany: { en: "%d sources", ur: "%d حوالے" },
  back: { en: "Back", ur: "واپس" },
  emptyTitle: { en: "Ask about the Prophet ﷺ", ur: "نبی کریم ﷺ کے بارے میں پوچھیے" },
  /**
   * The entire product explanation, for a judge who installs the APK with
   * nobody there to present it.
   *
   * It deliberately does NOT restate the disclaimer bar, which is permanently
   * on screen a few hundred pixels below and used to say almost this exact
   * sentence. Two elements spending the screen's scarcest resource on the same
   * claim is a waste; this one says the thing the bar cannot — that declining
   * is designed.
   *
   * ⚠️ The count 154 is load-bearing copy, not decoration. "Approved
   * collection" is vague and reads as marketing; a concrete, checkable number
   * supplies the REASON refusal exists — the collection is small and fixed, so
   * a bounded bot is the correct bot rather than a weak one. `npm run check`
   * asserts it against corpus.json, in BOTH languages, so it cannot drift
   * (scripts/shell-check.mjs).
   */
  emptyBody: {
    en: "Answers come from a fixed collection of 154 Seerah and Shamail entries, and each one shows its source. If a question falls outside the collection, or asks for a religious ruling, this bot will say so rather than guess.",
    ur: "جوابات ایک مقررہ ذخیرے سے آتے ہیں جس میں سیرت و شمائل کے ۱۵۴ اندراجات ہیں، اور ہر جواب اپنا حوالہ دکھاتا ہے۔ اگر سوال اس ذخیرے سے باہر ہو یا کسی شرعی حکم کے بارے میں ہو، تو یہ بوٹ اندازہ لگانے کے بجائے صاف کہہ دے گا۔",
  },
  // Labelled so a judge can see the guardrails before inventing a question.
  exampleInCorpus: { en: "What was the Prophet's ﷺ character like?", ur: "حضور ﷺ کا اخلاق کیسا تھا؟" },
  exampleOutOfCorpus: { en: "What did the Prophet ﷺ think about cryptocurrency?", ur: "کیا حضور ﷺ کرپٹو کرنسی کے بارے میں کچھ فرماتے ہیں؟" },
  exampleRuling: { en: "Is it sunnah to eat with the right hand?", ur: "کیا دائیں ہاتھ سے کھانا سنت ہے؟" },

  /**
   * ── Chip tags: label the OUTCOME, never the input category ───────────────
   *
   * These used to read "in the collection" / "outside it" / "a ruling
   * question", which described the question's relationship to the corpus.
   * Read cold, next to a question, that phrasing sounds like a warning — and
   * two of these three chips exist for the sole purpose of demonstrating a
   * refusal. Labels that discourage the taps whose entire point is being
   * tapped left three of the four rubric behaviours invisible to any judge who
   * only tried the first one.
   *
   * Naming the outcome does two jobs at once: it invites the tap, because the
   * chip is now obviously a demo of something, and it pre-frames the refusal
   * so that when it arrives it CONFIRMS the label rather than surprising.
   *
   * "Declined" appears twice on purpose, with two different reasons. Two
   * distinct refusal paths reading as a system is the point (§5.2); one
   * catch-all failure is not.
   *
   * `·` is the reference app's own separator idiom ("0 of 17 · 0 read").
   */
  tagInCorpus: { en: "Answered · with its source", ur: "جواب ملے گا · حوالے کے ساتھ" },
  tagOutOfCorpus: { en: "Declined · not in the collection", ur: "معذرت · ذخیرے میں نہیں" },
  tagRuling: { en: "Declined · sent to a scholar", ur: "معذرت · عالم کی طرف رہنمائی" },
  /**
   * Chip 4 — the same in-corpus question in the OTHER language.
   *
   * Keyed by the SHELL language, so the English shell advertises an Urdu answer
   * and vice versa. "same question" is the load-bearing half: it tells a judge
   * what they are comparing against chip 1, which is what makes the comparison
   * evaluable without reading Urdu.
   */
  tagOtherLang: { en: "Answered in Urdu · same question", ur: "جواب انگریزی میں · وہی سوال" },
  /**
   * A pointer to About from the landing screen.
   *
   * The disclaimer bar was the obvious candidate and was rejected: it must
   * never be dismissible, and a tappable bar invites a judge to tap it
   * expecting dismissal — risking a rubric item to close a gap the header's
   * `i` button already covers for anyone who inspects. This sits on the one
   * screen a judge is guaranteed to see first, and costs the bar nothing.
   */
  aboutLink: { en: "Read the corpus rules", ur: "اصولِ ذخیرہ پڑھیے" },
  rulesHeading: { en: "The rules this bot follows", ur: "وہ اصول جن کی یہ بوٹ پابندی کرتا ہے" },
  /**
   * Explains a DELIBERATE design choice that looks like a defect.
   *
   * §5.4 forbids the model from ever generating corpus text: the answer is the
   * model's own words, and verbatim material is read from the cache into the
   * source card. A judge sees an answer that does not match its own quotation
   * and has no way to know that is the safety mechanism working rather than
   * the bot failing to quote properly. Nothing anywhere told them.
   */
  paraphraseHeading: { en: "Why the answer and the source differ", ur: "جواب اور حوالہ مختلف کیوں ہوتے ہیں" },
  paraphraseBody: {
    en: "The answer is written in the bot's own words. The exact corpus wording — the hadith translation and its hawala — appears unaltered in the source card beneath it, read straight from the collection. The bot never writes scripture text itself, so anything shown as a source is always the published text.",
    ur: "جواب بوٹ اپنے الفاظ میں لکھتا ہے۔ ذخیرے کی اصل عبارت — حدیث کا ترجمہ اور اس کا حوالہ — نیچے حوالہ کارڈ میں بعینہٖ دکھائی جاتی ہے، جو سیدھی ذخیرے سے لی جاتی ہے۔ بوٹ خود کبھی متنِ حدیث نہیں لکھتا، اس لیے جو عبارت بطور حوالہ نظر آتی ہے وہ ہمیشہ شائع شدہ متن ہوتی ہے۔",
  },
  verbatimNote: {
    en: "Reproduced exactly as published by the organizers.",
    ur: "منتظمین کی شائع کردہ عبارت بعینہٖ نقل کی گئی ہے۔",
  },
  offline: { en: "Cannot reach the service.", ur: "سروس تک رسائی نہیں ہو سکی۔" },
  /**
   * Labels a quota or outage bubble. Its whole job is to stop a judge reading
   * a system failure as the bot having DECLINED — the two are different
   * claims, and only one of them is a considered position (§5.6).
   * Calm on purpose: no "error", no "failed", no alarm.
   */
  systemNotice: { en: "Temporary service issue", ur: "عارضی تکنیکی مسئلہ" },

  // ── Sources sheet ──────────────────────────────────────────────────────
  sheetTitle: { en: "Sources", ur: "حوالہ جات" },
  /** "Source 1 of 5" — the reference's own ordinal idiom ("Trait 1 of 17"). */
  sourceOf: { en: "Source %n of %m", ur: "حوالہ %n از %m" },
  close: { en: "Close", ur: "بند کریں" },
  prev: { en: "Previous source", ur: "پچھلا حوالہ" },
  next: { en: "Next source", ur: "اگلا حوالہ" },
  copy: { en: "Copy", ur: "نقل کریں" },
  copied: { en: "Copied", ur: "نقل ہو گیا" },
  /**
   * Heading for the sources appended to a copied ANSWER.
   *
   * Copying an answer without its citation would put an unsourced religious
   * claim in someone's clipboard — the exact thing §5.3 exists to prevent,
   * escaping through the one door validation does not watch.
   */
  copiedSources: { en: "Sources:", ur: "حوالہ جات:" },

  // ── Message actions ────────────────────────────────────────────────────
  // Every icon-only control is labelled in both languages: an unlabelled
  // icon is invisible to a screen reader, and §7.1 requires the whole shell
  // localized, not just the answer path.
  copyAnswer: { en: "Copy answer with sources", ur: "جواب بمع حوالہ جات نقل کریں" },
  edit: { en: "Edit", ur: "ترمیم کریں" },
  editMessage: { en: "Edit your message", ur: "اپنے پیغام میں ترمیم کریں" },
  cancel: { en: "Cancel", ur: "منسوخ کریں" },
  longPressHint: { en: "Long press for options", ur: "اختیارات کے لیے دیر تک دبائیں" },
  shamail: { en: "Shamail", ur: "شمائل" },
  timeline: { en: "Seerah timeline", ur: "سیرت ٹائم لائن" },
};

export const t = (key: keyof typeof UI, lang: Language) => UI[key][lang];
