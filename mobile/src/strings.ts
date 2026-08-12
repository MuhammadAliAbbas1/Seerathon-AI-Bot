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
  hideSources: { en: "Hide sources", ur: "حوالے چھپائیں" },
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
};

export const t = (key: keyof typeof UI, lang: Language) => UI[key][lang];
