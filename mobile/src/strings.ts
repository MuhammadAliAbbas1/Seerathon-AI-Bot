import type { Language } from "./api";

/**
 * SHELL copy only — labels, placeholders, screen titles.
 *
 * The answer-path strings (fallback, alim redirect, quota, error, disclaimer)
 * come from the SERVER, so there is exactly one source of truth for the
 * language a judge actually reads (§7.1). Do not duplicate them here.
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
  emptyBody: {
    en: "Answers come only from the approved collection, and each one shows its source. Try one of these:",
    ur: "جوابات صرف منظور شدہ ذخیرے سے آتے ہیں، اور ہر جواب اپنا حوالہ دکھاتا ہے۔ ان میں سے کوئی آزمائیے:",
  },
  // Labelled so a judge can see the guardrails before inventing a question.
  exampleInCorpus: { en: "What was the Prophet's ﷺ character like?", ur: "حضور ﷺ کا اخلاق کیسا تھا؟" },
  exampleOutOfCorpus: { en: "What did the Prophet ﷺ think about cryptocurrency?", ur: "کیا حضور ﷺ کرپٹو کرنسی کے بارے میں کچھ فرماتے ہیں؟" },
  exampleRuling: { en: "Is it sunnah to eat with the right hand?", ur: "کیا دائیں ہاتھ سے کھانا سنت ہے؟" },
  tagInCorpus: { en: "in the collection", ur: "ذخیرے میں" },
  tagOutOfCorpus: { en: "outside it", ur: "ذخیرے سے باہر" },
  tagRuling: { en: "a ruling question", ur: "شرعی حکم کا سوال" },
  rulesHeading: { en: "The rules this bot follows", ur: "وہ اصول جن کی یہ بوٹ پابندی کرتا ہے" },
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
  shamail: { en: "Shamail", ur: "شمائل" },
  timeline: { en: "Seerah timeline", ur: "سیرت ٹائم لائن" },
};

export const t = (key: keyof typeof UI, lang: Language) => UI[key][lang];
