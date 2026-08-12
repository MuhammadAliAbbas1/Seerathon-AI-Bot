import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, dashedCard, flatCard, radius, space, type, bodyStyle, metaStyle, isUr } from "./theme";
import { t } from "./strings";
import type { Citation, Language, Mode } from "./api";

/* ── Header ─────────────────────────────────────────────────────────────── */

export function Header({
  lang,
  onToggleLang,
  onAbout,
  title,
}: {
  lang: Language;
  onToggleLang: () => void;
  onAbout: () => void;
  title: string;
}) {
  return (
    <View style={s.header}>
      <Text style={[type.title, isUr(lang) && { fontSize: 24 }]}>{title}</Text>
      <View style={s.headerRight}>
        {/* Copied from the reference's own UR/EN pill (§12.1) so language
            switching reads as native to that app rather than bolted on. */}
        <Pressable onPress={onToggleLang} style={s.pill} accessibilityLabel="Switch language">
          <View style={[s.pillHalf, lang === "ur" && s.pillHalfOn]}>
            <Text style={[s.pillText, lang === "ur" && s.pillTextOn]}>UR</Text>
          </View>
          <View style={[s.pillHalf, lang === "en" && s.pillHalfOn]}>
            <Text style={[s.pillText, lang === "en" && s.pillTextOn]}>EN</Text>
          </View>
        </Pressable>
        <Pressable onPress={onAbout} style={s.iconBtn} accessibilityLabel="About and corpus rules">
          <Text style={s.iconGlyph}>i</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ── Message bubbles ────────────────────────────────────────────────────── */

export function UserBubble({ text, lang }: { text: string; lang: Language }) {
  const ur = isUr(lang);
  return (
    <View style={[s.row, ur ? { justifyContent: "flex-start" } : { justifyContent: "flex-end" }]}>
      <View style={[s.bubble, s.userBubble, ur ? s.userBubbleUr : s.userBubbleEn]}>
        <Text style={[bodyStyle(lang), { color: color.onPrimary }]}>{text}</Text>
      </View>
    </View>
  );
}

/**
 * One bot turn. `mode` drives the treatment, and the treatments are
 * deliberately close together: a refusal is a courtesy, not an error (§12.2).
 * No red anywhere — including for quota, which a judge may genuinely see on
 * stage when RPM trips (§5.6).
 */
export function BotBubble({
  text,
  lang,
  mode,
  citations,
}: {
  text: string;
  lang: Language;
  mode: Mode | "quota" | "error";
  citations?: Citation[];
}) {
  const [open, setOpen] = useState(false);
  const ur = isUr(lang);
  const marked = mode === "ruling_seeking" || mode === "quota" || mode === "error";

  return (
    <View style={[s.row, ur ? { justifyContent: "flex-end" } : { justifyContent: "flex-start" }]}>
      <View style={{ maxWidth: "88%" }}>
        <View
          style={[
            s.bubble,
            s.botBubble,
            ur ? s.botBubbleUr : s.botBubbleEn,
            // A gold rule marks "this is a considered position, not a failure".
            marked && (ur ? s.markedUr : s.markedEn),
          ]}
        >
          <Text style={bodyStyle(lang)}>{text}</Text>
        </View>

        {citations && citations.length > 0 && (
          <>
            <Pressable
              onPress={() => setOpen((v) => !v)}
              style={[s.chip, ur && { alignSelf: "flex-end" }]}
              accessibilityLabel="Show sources"
            >
              <Text style={s.chipText}>
                {open
                  ? t("hideSources", lang)
                  : citations.length === 1
                    ? t("sourcesOne", lang)
                    : t("sourcesMany", lang).replace("%d", String(citations.length))}
              </Text>
            </Pressable>
            {open && citations.map((c) => <SourceCard key={c.id} c={c} lang={lang} />)}
          </>
        )}
      </View>
    </View>
  );
}

/**
 * The source card. Everything in it comes from the baked corpus, read after
 * validation — the model supplied an id and nothing else (§5.4). This is the
 * only place verbatim corpus text ever reaches the user, which is also what
 * keeps Gemini's recitation filter out of the answer path.
 */
export function SourceCard({ c, lang }: { c: Citation; lang: Language }) {
  const ur = isUr(lang);
  return (
    <View style={[s.source, ur ? s.sourceUr : s.sourceEn]}>
      <Text style={[metaStyle(lang), { color: color.primary, fontWeight: "600" }]}>{c.title}</Text>
      <Text style={[bodyStyle(lang), { marginTop: space.sm }]}>{c.text}</Text>
      <Text style={[metaStyle(lang), { marginTop: space.sm }]}>
        {c.type === "shamail" ? "Shamail" : "Seerah timeline"} · {c.id.slice(0, 8)}…
      </Text>
    </View>
  );
}

/* ── Persistent disclaimer ──────────────────────────────────────────────── */

/**
 * Pinned above the composer. Never dismissible, never collapsible, never
 * shown-once.
 *
 * §12.3: this is OFF-STYLE by construction — nothing in the reference app is
 * permanently pinned. It ships anyway, because usage_rules[5] requires it and
 * it is one of the four demo behaviours. We pay the cost by making it the
 * quietest element on screen, NOT by making it dismissible.
 */
export function DisclaimerBar({ text, lang }: { text: string; lang: Language }) {
  return (
    <View style={s.disclaimer}>
      <Text
        style={[
          isUr(lang) ? type.disclaimerUr : type.disclaimer,
          { textAlign: "center", writingDirection: isUr(lang) ? "rtl" : "ltr" },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

/* ── Empty state ────────────────────────────────────────────────────────── */

/**
 * Doubles as the demo script: one in-corpus, one out-of-corpus, one
 * ruling-shaped example, each labelled. The guardrails are visible before a
 * judge has to think of a question (§12.2).
 */
export function EmptyState({ lang, onPick }: { lang: Language; onPick: (q: string) => void }) {
  const examples: Array<[string, string]> = [
    ["exampleInCorpus", "tagInCorpus"],
    ["exampleOutOfCorpus", "tagOutOfCorpus"],
    ["exampleRuling", "tagRuling"],
  ];
  return (
    <View style={s.empty}>
      <View style={s.mark}>
        {/* Same visual family as the reference — a gold dome outline — but
            enclosing a chat form rather than their calligraphy, so it is
            plainly a different mark (§12.3). No asset is reused. */}
        <View style={s.markDomeOuter}>
          <View style={s.markFinial} />
          <View style={s.markDome} />
          <View style={s.markBubble} />
        </View>
      </View>
      <Text style={[type.title, { textAlign: "center", marginTop: space.lg }]}>{t("emptyTitle", lang)}</Text>
      <Text style={[metaStyle(lang), { textAlign: "center", marginTop: space.sm, marginBottom: space.xl }]}>
        {t("emptyBody", lang)}
      </Text>
      {examples.map(([qKey, tagKey]) => (
        <Pressable key={qKey} style={s.example} onPress={() => onPick(t(qKey as never, lang))}>
          <Text style={[bodyStyle(lang), { fontSize: isUr(lang) ? 17 : 15 }]}>{t(qKey as never, lang)}</Text>
          <Text style={[type.meta, { marginTop: space.xs }]}>{t(tagKey as never, lang)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/* ── styles ─────────────────────────────────────────────────────────────── */

const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.xl,
    paddingTop: 56,
    paddingBottom: space.md,
    backgroundColor: color.bg,
    borderBottomWidth: 1,
    borderBottomColor: color.divider,
  },
  headerRight: { flexDirection: "row", alignItems: "center", gap: space.md },
  pill: {
    flexDirection: "row",
    backgroundColor: color.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: color.divider,
    padding: 2,
  },
  pillHalf: { paddingHorizontal: space.md, paddingVertical: 5, borderRadius: 999 },
  pillHalfOn: { backgroundColor: color.primary },
  pillText: { fontSize: 12, fontWeight: "700", color: color.textSoft },
  pillTextOn: { color: color.onPrimary },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.divider,
    alignItems: "center",
    justifyContent: "center",
  },
  iconGlyph: { fontSize: 15, fontWeight: "700", color: color.primary },

  row: { flexDirection: "row", paddingHorizontal: space.lg, marginTop: space.md },
  bubble: { paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.bubble },
  userBubble: { backgroundColor: color.primary, maxWidth: "85%" },
  userBubbleEn: { borderBottomRightRadius: radius.tight },
  userBubbleUr: { borderBottomLeftRadius: radius.tight },
  // Flat with a hairline, not a shadow — a floating bubble would read as a
  // different app next to the reference (§12.2).
  botBubble: { ...flatCard, borderRadius: radius.bubble },
  botBubbleEn: { borderBottomLeftRadius: radius.tight },
  botBubbleUr: { borderBottomRightRadius: radius.tight },
  markedEn: { borderLeftWidth: 3, borderLeftColor: color.gold },
  markedUr: { borderRightWidth: 3, borderRightColor: color.gold },

  chip: {
    alignSelf: "flex-start",
    marginTop: space.sm,
    marginLeft: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.chip,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.primary,
  },
  chipText: { ...type.chip, color: color.primary },

  source: {
    ...flatCard,
    marginTop: space.sm,
    padding: space.lg,
    borderLeftWidth: 3,
    borderLeftColor: color.gold,
  },
  sourceEn: {},
  sourceUr: { borderLeftWidth: 1, borderLeftColor: color.divider, borderRightWidth: 3, borderRightColor: color.gold },

  disclaimer: {
    backgroundColor: color.band,
    borderTopWidth: 1,
    borderTopColor: color.divider,
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
  },

  empty: { paddingHorizontal: space.xl, paddingTop: space.xxl, alignItems: "stretch" },
  mark: { alignItems: "center" },
  markDomeOuter: { width: 92, height: 92, alignItems: "center", justifyContent: "flex-end" },
  markFinial: { width: 2, height: 14, backgroundColor: color.gold, borderRadius: 1 },
  markDome: {
    width: 66,
    height: 46,
    borderWidth: 2,
    borderColor: color.gold,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    borderBottomWidth: 0,
  },
  markBubble: {
    position: "absolute",
    bottom: 8,
    width: 34,
    height: 22,
    borderWidth: 2,
    borderColor: color.primary,
    borderRadius: 8,
    borderBottomLeftRadius: 2,
  },
  example: { ...dashedCard, padding: space.lg, marginBottom: space.md },
});

export const styles = s;
