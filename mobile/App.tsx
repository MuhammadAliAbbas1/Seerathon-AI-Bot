// Throwaway hello-world for Phase 1(c) — its job is to de-risk the EAS
// pipeline AND answer the font questions from CLAUDE.md §7.1 in one install.
//
// Read this screen on a real device, not the emulator. RN's RTL handling and
// Android's font fallback both differ between them (§7.1).
//
// Every Urdu string below is real corpus text from corpus.json, not invented
// sample text — the point is to see what the app will actually have to render.

import { StatusBar } from "expo-status-bar";
import { I18nManager, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

// U+FDFA ARABIC LIGATURE SALLALLAHOU ALAYHE WASALLAM.
// Written as an escape so the file's own encoding can never be the variable:
// if this renders and the literal below does not, the bug is the file, not
// the font.
const SALLALLAHU_ESCAPED = "ﷺ";
const SALLALLAHU_LITERAL = "ﷺ";

// From corpus.json — entry 672b3e8ed458540020750eab.
const UR_TITLE = "حضور ر ﷺکا  ذاتی انتقام نہ لینا";
const UR_HAWALA = "(صحیح بخاری حدیث 3560)"; // Urdu + Latin digits: mixed direction
const UR_BODY =
  "عائشہ رضی اللہ عنہا سے روایت ہے کہ حضورﷺ  نے اپنی ذات کے لیے کبھی کسی سے بد لہ نہیں لیا ۔";
const EN_TITLE = "Sayyid al-Mursalin ﷺ never took personal revenge";

function Row({ label, children, note }: { label: string; children: React.ReactNode; note?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

export default function App() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>Seerathon — render check</Text>
      <Text style={styles.sub}>
        Phase 1(c) throwaway. If anything below is a tofu box (□) or reads
        left-to-right when it should read right-to-left, say so before Phase 4.
      </Text>

      <Row label="1 · ﷺ glyph, escaped (U+FDFA), 64pt" note="A box here means the font lacks the glyph.">
        <Text style={styles.glyph}>{SALLALLAHU_ESCAPED}</Text>
      </Row>

      <Row label="2 · ﷺ glyph, literal in source" note="Differs from #1 ⇒ file encoding problem, not a font problem.">
        <Text style={styles.glyph}>{SALLALLAHU_LITERAL}</Text>
      </Row>

      <Row label="3 · Urdu title (RTL)" note="Should start at the RIGHT edge.">
        <Text style={styles.urdu}>{UR_TITLE}</Text>
      </Row>

      <Row label="4 · Urdu body (RTL, multi-line)" note="Line breaks should stack right-aligned.">
        <Text style={styles.urdu}>{UR_BODY}</Text>
      </Row>

      <Row
        label="5 · Mixed direction: Urdu + Latin digits"
        note="Digits 3560 must stay 3-5-6-0 and sit in the right place. This is the case most likely to break."
      >
        <Text style={styles.urdu}>{UR_HAWALA}</Text>
      </Row>

      <Row label="6 · English with ﷺ inline" note="Glyph should sit on the baseline, not clip.">
        <Text style={styles.english}>{EN_TITLE}</Text>
      </Row>

      <Row label="7 · Environment">
        <Text style={styles.mono}>
          {`platform      ${Platform.OS} ${Platform.Version}\n` +
            `I18nManager.isRTL   ${I18nManager.isRTL}\n` +
            `allowRTL / forceRTL not set by this build`}
        </Text>
      </Row>

      <Text style={styles.footer}>
        Font decision belongs in Phase 1, not Phase 4 — it affects bundle size.
      </Text>
      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fdfdfb" },
  content: { padding: 20, paddingTop: 64, paddingBottom: 48 },
  h1: { fontSize: 22, fontWeight: "600", color: "#14281d" },
  sub: { fontSize: 13, color: "#5b6b60", marginTop: 6, marginBottom: 24, lineHeight: 19 },
  row: { marginBottom: 26, borderTopWidth: 1, borderTopColor: "#e4eae5", paddingTop: 12 },
  label: { fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: "#7c8b81", marginBottom: 8 },
  note: { fontSize: 12, color: "#94a29a", marginTop: 8, fontStyle: "italic" },
  glyph: { fontSize: 64, color: "#14281d", textAlign: "center" },
  // writingDirection is the explicit signal. Without it the platform guesses
  // from the first strong character, which is the thing we want to observe.
  urdu: { fontSize: 22, lineHeight: 40, color: "#14281d", textAlign: "right", writingDirection: "rtl" },
  english: { fontSize: 17, lineHeight: 26, color: "#14281d" },
  mono: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12, color: "#3d4f45", lineHeight: 18 },
  footer: { fontSize: 12, color: "#94a29a", marginTop: 8 },
});
