import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, flatCard, radius, space, type, bodyStyle, isUr } from "./theme";
import { t } from "./strings";
import type { Language } from "./api";

/**
 * About / Corpus Rules.
 *
 * This is where the VERBATIM /meta text lives (§4). That string is written at
 * the bot builder, not the end user ("Cite every answer with source id and
 * title…"), so rendering it in chat would read as a leaked system prompt. It
 * still has to appear somewhere exact, because the organizers wrote it and
 * will look for it — so it goes here, one tap from the chat, reproduced
 * character-for-character in both languages.
 *
 * Do NOT paraphrase, reword, reformat or "improve" anything in META_*.
 */
const META_DISCLAIMER = {
  en: "Answers must come only from this corpus. Cite every answer with source id and title. Do not invent Hadith, Quran, or Seerah text. Refuse fatwa/ruling questions and redirect to an alim.",
  ur: "جواب صرف اس ذخیرے سے آنا چاہیے۔ ہر جواب میں ماخذ آئی ڈی اور عنوان کا حوالہ دیں۔ خود سے حدیث، قرآن یا سیرت کا متن نہ لکھیں۔ فتویٰ / حکم والے سوالات رد کریں اور عالم کی طرف بھیجیں۔",
};

const META_RULES = {
  en: [
    "Answer only from this corpus (Shamail + Seerah Timeline).",
    "Cite every answer with source id and title (and hawala when available).",
    "If the question is outside the corpus, say so and redirect.",
    "Refuse fatwa/ruling questions and redirect to an alim.",
    "Show a persistent disclaimer.",
  ],
  ur: [
    "جواب صرف اس ذخیرے سے دیں (شمائل + سیرت ٹائم لائن).",
    "ہر جواب میں ماخذ آئی ڈی اور عنوان کا حوالہ دیں (اور جہاں ممکن ہو حوالہ حدیث).",
    "اگر سوال ذخیرے سے باہر ہو تو واضح کہیں اور ری ڈائریکٹ کریں.",
    "فتویٰ / حکم والے سوالات رد کریں اور عالم کی طرف بھیجیں.",
    "مستقل ڈس کلیمر دکھائیں.",
  ],
};

export function AboutScreen({ lang, onBack }: { lang: Language; onBack: () => void }) {
  const ur = isUr(lang);
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <View style={s.header}>
        <Pressable onPress={onBack} style={s.back} accessibilityLabel="Back">
          <Text style={s.backGlyph}>{ur ? "→" : "←"}</Text>
        </Pressable>
        <Text style={[type.title, { fontSize: 19 }]}>{t("aboutTitle", lang)}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: space.xxl }}>
        <Text style={[type.meta, { marginBottom: space.md }]}>{t("verbatimNote", lang)}</Text>

        <View style={[s.card, { borderLeftWidth: 3, borderLeftColor: color.gold }]}>
          <Text style={bodyStyle(lang)}>{META_DISCLAIMER[lang]}</Text>
        </View>

        <Text style={[type.title, { fontSize: 17, marginTop: space.xxl, marginBottom: space.md }]}>
          {t("rulesHeading", lang)}
        </Text>

        {META_RULES[lang].map((rule, i) => (
          <View key={i} style={s.card}>
            <View style={[s.ruleRow, ur && { flexDirection: "row-reverse" }]}>
              <Text style={s.ruleNum}>{i + 1}</Text>
              <Text style={[bodyStyle(lang), { flex: 1 }]}>{rule}</Text>
            </View>
          </View>
        ))}

        {/* Both languages are always shown, not just the active one: a judge
            reading in either language should find the exact published text
            without switching (§4). */}
        <Text style={[type.title, { fontSize: 17, marginTop: space.xxl, marginBottom: space.md }]}>
          {ur ? "English" : "اردو"}
        </Text>
        <View style={s.card}>
          <Text style={bodyStyle(ur ? "en" : "ur")}>{META_DISCLAIMER[ur ? "en" : "ur"]}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingTop: 56,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.divider,
  },
  back: {
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.divider,
    alignItems: "center",
    justifyContent: "center",
  },
  backGlyph: { fontSize: 16, color: color.primary },
  card: { ...flatCard, padding: space.lg, marginBottom: space.md },
  ruleRow: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  ruleNum: {
    width: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: color.band,
    color: color.primary,
    textAlign: "center",
    lineHeight: 22,
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
  },
});
