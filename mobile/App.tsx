import { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { ask } from "./src/api";
import type { AskResponse, Citation, Language, Mode } from "./src/api";
import { AboutScreen } from "./src/AboutScreen";
import { BotBubble, DisclaimerBar, EmptyState, Header, UserBubble } from "./src/components";
import { color, isUr, space, type } from "./src/theme";
import { t } from "./src/strings";

/**
 * Seerathon chat surface, built to §12.
 *
 * Everything a user reads on a non-answer path comes from the SERVER, not from
 * here — one source of truth for the copy that carries three of the four
 * rubric behaviours (§7.1).
 */

interface Turn {
  id: number;
  role: "user" | "bot";
  text: string;
  lang: Language;
  mode?: Mode | "quota" | "error";
  citations?: Citation[];
}

/** Shown until the first server response tells us the real one. */
const BOOT_DISCLAIMER: Record<Language, string> = {
  en: "Answers come only from an approved Seerah and Shamail collection, and each one shows its source. This is not a source of religious rulings.",
  ur: "جوابات صرف منظور شدہ سیرت و شمائل کے ذخیرے سے آتے ہیں، اور ہر جواب اپنا حوالہ ساتھ دکھاتا ہے۔ یہ شرعی احکام کا ذریعہ نہیں۔",
};

export default function App() {
  const [lang, setLang] = useState<Language>("en");
  const [screen, setScreen] = useState<"chat" | "about">("chat");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [disclaimer, setDisclaimer] = useState<string>(BOOT_DISCLAIMER.en);
  const scroller = useRef<ScrollView>(null);
  const nextId = useRef(1);

  if (screen === "about") {
    return <AboutScreen lang={lang} onBack={() => setScreen("chat")} />;
  }

  const submit = async (raw?: string) => {
    const question = (raw ?? input).trim();
    if (!question || busy) return;
    setInput("");
    setBusy(true);

    setTurns((prev) => [...prev, { id: nextId.current++, role: "user", text: question, lang }]);
    requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));

    const res: AskResponse = await ask(question, lang);

    setTurns((prev) => {
      if (res.kind === "ok") {
        return [
          ...prev,
          {
            id: nextId.current++,
            role: "bot",
            // The server's language is AUTHORITATIVE — it may have detected
            // Urdu from the question regardless of the toggle (§5.4).
            lang: res.language,
            text: res.answer,
            mode: res.mode,
            citations: res.citations,
          },
        ];
      }
      return [
        ...prev,
        {
          id: nextId.current++,
          role: "bot",
          lang: res.language,
          // Quota and outage copy comes from the server too, so it is
          // localized and worded once.
          text: res.message || t("offline", res.language),
          mode: res.code === "quota_exhausted" ? "quota" : "error",
        },
      ];
    });

    if (res.kind === "ok") {
      setDisclaimer(res.disclaimer);
      if (res.language !== lang) setLang(res.language);
    }
    setBusy(false);
    requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
  };

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <Header
        lang={lang}
        title={t("appTitle", lang)}
        onToggleLang={() => {
          const next: Language = lang === "en" ? "ur" : "en";
          setLang(next);
          setDisclaimer(BOOT_DISCLAIMER[next]);
        }}
        onAbout={() => setScreen("about")}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          ref={scroller}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: space.xl }}
          keyboardShouldPersistTaps="handled"
        >
          {turns.length === 0 ? (
            <EmptyState lang={lang} onPick={(q) => submit(q)} />
          ) : (
            turns.map((turn) =>
              turn.role === "user" ? (
                <UserBubble key={turn.id} text={turn.text} lang={turn.lang} />
              ) : (
                <BotBubble
                  key={turn.id}
                  text={turn.text}
                  lang={turn.lang}
                  mode={turn.mode ?? "in_corpus"}
                  citations={turn.citations}
                />
              )
            )
          )}
          {busy && (
            <View style={s.busy}>
              <ActivityIndicator color={color.primary} />
              <Text style={[type.meta, { marginLeft: space.sm }]}>{t("thinking", lang)}</Text>
            </View>
          )}
        </ScrollView>

        {/* Pinned, non-dismissible, and deliberately the quietest thing on
            screen. Off-style for the reference app, required by the rubric
            (§12.3) — it does not collapse and it has no close affordance. */}
        <DisclaimerBar text={disclaimer} lang={lang} />

        <View style={s.composer}>
          <TextInput
            style={[
              s.input,
              isUr(lang) && { textAlign: "right", writingDirection: "rtl", fontSize: 17, lineHeight: 26 },
            ]}
            value={input}
            onChangeText={setInput}
            placeholder={t("placeholder", lang)}
            placeholderTextColor={color.textSoft}
            multiline
            onSubmitEditing={() => submit()}
            editable={!busy}
          />
          <Pressable
            onPress={() => submit()}
            disabled={busy || !input.trim()}
            style={[s.send, (busy || !input.trim()) && { opacity: 0.4 }]}
          >
            <Text style={s.sendText}>{t("send", lang)}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  busy: { flexDirection: "row", alignItems: "center", padding: space.xl },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space.sm,
    padding: space.md,
    paddingBottom: space.xl,
    backgroundColor: color.bg,
    borderTopWidth: 1,
    borderTopColor: color.divider,
  },
  input: {
    flex: 1,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.divider,
    borderRadius: 14,
    paddingHorizontal: space.lg,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: 15,
    lineHeight: 21,
    maxHeight: 120,
    color: color.text,
  },
  send: {
    backgroundColor: color.primary,
    borderRadius: 12,
    paddingHorizontal: space.xl,
    paddingVertical: 13,
  },
  sendText: { color: color.onPrimary, fontWeight: "700", fontSize: 14 },
});
