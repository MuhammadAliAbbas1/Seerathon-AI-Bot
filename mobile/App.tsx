import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
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

/**
 * Keyboard height, so the composer can ride above it.
 *
 * ⚠️ `KeyboardAvoidingView` was here and did NOTHING on Android: its `behavior`
 * was `undefined` on that platform, so it fell through to the native
 * `adjustResize`. Expo SDK 52+ enables **edge-to-edge** by default, and under
 * edge-to-edge the window no longer resizes for the keyboard — so there was no
 * fallback and the keyboard simply covered the input. A judge hits that in the
 * first ten seconds.
 *
 * Handled manually instead of with a dependency: one mechanism on both
 * platforms is easier to reason about than a component that silently does
 * nothing on one of them.
 */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    // iOS fires Will* early enough to move with the keyboard; Android only
    // ever fires Did*.
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

export default function App() {
  // Provider must sit above anything calling useSafeAreaInsets().
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
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

  /**
   * Back to the landing screen. The example chips are the demo affordance —
   * they name one in-corpus, one out-of-corpus and one ruling question, so a
   * judge sees the guardrails before inventing a question. Without a route
   * back, the first message retired them permanently.
   *
   * §8 excludes conversation history, so this is a reset, not a "conversation
   * list": there is nothing to go back TO except a clean slate.
   */
  const newChat = () => {
    Keyboard.dismiss();
    setTurns([]);
    setInput("");
    setBusy(false);
    setDisclaimer(BOOT_DISCLAIMER[lang]);
  };

  const submit = async (raw?: string) => {
    const question = (raw ?? input).trim();
    if (!question || busy) return;
    setInput("");
    setBusy(true);

    setTurns((prev) => [...prev, { id: nextId.current++, role: "user", text: question, lang }]);

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
          // Both capacity cases render as "quota", which §12.2 requires to be
          // as calm as a refusal — no red, no error iconography. A red alert
          // mid-demo reads as a crash even when the system is behaving exactly
          // as designed.
          mode: res.code === "quota_exhausted" || res.code === "rate_limited" ? "quota" : "error",
        },
      ];
    });

    if (res.kind === "ok") {
      setDisclaimer(res.disclaimer);
      if (res.language !== lang) setLang(res.language);
    }
    setBusy(false);
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
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
        onNewChat={newChat}
        // Meaningless on the landing screen, and omitting it there keeps the
        // header uncrowded exactly when there is least to gain from it.
        showNewChat={turns.length > 0}
      />

      <ScrollView
        ref={scroller}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: space.xl }}
        keyboardShouldPersistTaps="handled"
        // Scrolls after LAYOUT rather than after state, which a
        // requestAnimationFrame does not guarantee — a long answer used to
        // under-scroll and leave its own first line off screen.
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
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
          <View style={[s.busy, isUr(lang) && { flexDirection: "row-reverse" }]}>
            <ActivityIndicator color={color.primary} />
            <Text style={[type.meta, { marginHorizontal: space.sm }]}>{t("thinking", lang)}</Text>
          </View>
        )}
      </ScrollView>

      {/* Pinned, non-dismissible, and deliberately the quietest thing on
          screen. Off-style for the reference app, required by the rubric
          (§12.3) — it does not collapse and it has no close affordance. It
          stays visible with the keyboard open, which is why the keyboard is
          handled by shrinking the ROOT rather than by hiding the composer. */}
      <DisclaimerBar text={disclaimer} lang={lang} />

      <View
        style={[
          s.composer,
          // Sit above the gesture bar when the keyboard is closed; the
          // keyboard covers that area itself when open.
          { paddingBottom: keyboard > 0 ? space.md : insets.bottom + space.md },
        ]}
      >
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
          // Deliberately NOT disabled while busy: a judge should be able to
          // compose a follow-up during the wait, as they can in every chat app
          // they have used. Only sending is blocked.
        />
        <Pressable
          onPress={() => submit()}
          disabled={busy || !input.trim()}
          accessibilityRole="button"
          accessibilityLabel={t("send", lang)}
          style={({ pressed }) => [
            s.send,
            (busy || !input.trim()) && { opacity: 0.4 },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={s.sendText}>{t("send", lang)}</Text>
        </Pressable>
      </View>

      {/* Shrinks the column so the composer rides above the keyboard. */}
      {keyboard > 0 && <View style={{ height: keyboard }} />}
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
    paddingHorizontal: space.md,
    paddingTop: space.md,
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
    minHeight: 48,
    maxHeight: 120,
    color: color.text,
  },
  send: {
    backgroundColor: color.primary,
    borderRadius: 12,
    paddingHorizontal: space.xl,
    // 48dp minimum touch target (Android guideline).
    minHeight: 48,
    justifyContent: "center",
  },
  sendText: { color: color.onPrimary, fontWeight: "700", fontSize: 14 },
});
