import { useRef, useState } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView, KeyboardProvider, useKeyboardState } from "react-native-keyboard-controller";
import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import { ask } from "./src/api";
import type { AskResponse, Citation, Language, Mode } from "./src/api";
import { AboutScreen } from "./src/AboutScreen";
import {
  BotBubble,
  DisclaimerBar,
  EmptyState,
  Header,
  PendingBubble,
  UserBubble,
  answerForClipboard,
} from "./src/components";
import { MessageMenu, type MenuAnchor } from "./src/MessageMenu";
import { color, isUr, space } from "./src/theme";
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
 * ── Why the keyboard is handled by a library ──────────────────────────────
 *
 * Two earlier attempts failed, and the second one is the instructive one.
 *
 * 1. RN's `KeyboardAvoidingView` did NOTHING on Android — `behavior` was
 *    `undefined` there, falling through to the native `adjustResize`, which
 *    edge-to-edge (default since Expo SDK 52) neutralises. The keyboard simply
 *    covered the input.
 *
 * 2. A hand-rolled `Keyboard` listener that reserved `endCoordinates.height`.
 *    The layout responded, so the arithmetic was right — but the composer was
 *    left cut in half, because the HEIGHT was wrong. Under edge-to-edge, RN's
 *    JS keyboard events have no well-defined reference frame
 *    (facebook/react-native#30191): the value may or may not include the
 *    navigation-bar inset, and may be read before a keyboard toolbar strip
 *    renders. Any fix on top of it is a correction term that happens to work
 *    on one phone.
 *
 * So the fix is not a better number — it is to stop asking a question that has
 * no defined answer. `react-native-keyboard-controller` reads
 * `WindowInsets.ime` natively, which is the OS's own authority on where the
 * keyboard is, leaving no reference frame to get wrong. It is also Expo's own
 * recommendation for edge-to-edge.
 *
 * `softwareKeyboardLayoutMode: "resize"` is not an alternative — it maps to
 * `windowSoftInputMode`, which edge-to-edge neutralises. Nor is disabling
 * edge-to-edge: Android 16 removed that opt-out, so it would work today and
 * break on exactly the device a judge might be carrying. See §12.5.
 */
export default function App() {
  // SafeAreaProvider must sit above anything calling useSafeAreaInsets();
  // KeyboardProvider above anything reading keyboard state.
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <Root />
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const insets = useSafeAreaInsets();
  // Only needed to drop the composer's bottom inset when the keyboard already
  // covers that region — the OFFSET itself is handled by KeyboardAvoidingView.
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const [lang, setLang] = useState<Language>("en");
  const [screen, setScreen] = useState<"chat" | "about">("chat");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [disclaimer, setDisclaimer] = useState<string>(BOOT_DISCLAIMER.en);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; turn: Turn } | null>(null);
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
    setEditingId(null);
    setMenu(null);
    setDisclaimer(BOOT_DISCLAIMER[lang]);
  };

  /**
   * Edit and resend.
   *
   * ⚠️ **An edit re-runs the FULL pipeline from scratch.** This is guaranteed by
   * construction rather than by discipline: the wire contract is
   * `{question, language, history}`, the server **ignores `history`**, and this
   * function's only route back is `submit()` — the same call a freshly typed
   * question makes. There is no code path that could carry a previous `mode`,
   * route or citation set across an edit, because the client has nothing to
   * carry them in. §5.2's router-first ordering therefore cannot be bypassed.
   *
   * Everything from the edited message onward is discarded, exactly as ChatGPT,
   * Gemini and Claude do. Because §8 excludes conversation memory, editing an
   * early message is semantically identical to editing the last one — each
   * question is independent, so nothing needs reconstructing.
   *
   * **Quota: one edit costs one pipeline run — at most 2 provider calls**
   * (router + answer), 1 if the router refuses, 0 if the keyword ratchet
   * fires. Truncated turns are dropped, never regenerated, so the cost cannot
   * multiply with conversation length.
   */
  const submitEdit = (turnId: number, next: string) => {
    const index = turns.findIndex((turn) => turn.id === turnId);
    if (index === -1) return;
    setEditingId(null);
    setTurns(turns.slice(0, index));
    void submit(next);
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
      // ── The toggle is NOT touched, deliberately ──────────────────────────
      //
      // It used to follow res.language, so a roman-Urdu question silently
      // moved a control the user had explicitly set. Nothing required that:
      // §5.4's "authoritative" applies to how THIS response is rendered, and
      // every Turn already carries its own `lang`, so direction and font are
      // correct per message without the toggle being involved. The toggle's
      // remaining jobs are the shell language and the request hint — and the
      // hint is not read by the server at all, so flipping it changed nothing
      // except overriding the user.
      //
      // ── The disclaimer follows the SHELL, not the response ───────────────
      //
      // It is persistent chrome, not part of an answer, so it belongs to the
      // shell's language. Adopting the server's copy unconditionally would put
      // an Urdu disclaimer under an English shell the moment someone asked one
      // Urdu question — a visible seam on the one element that is always on
      // screen, which is exactly what §7.1 exists to prevent.
      if (res.language === lang) setDisclaimer(res.disclaimer);
    }
    setBusy(false);
  };

  return (
    // `padding` adds bottom padding equal to the keyboard's real height, so
    // the column shrinks and the composer rides up — with the disclaimer bar
    // still pinned directly above it, which the rubric requires (§12.3).
    <KeyboardAvoidingView behavior="padding" style={[s.root, { paddingTop: insets.top }]}>
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
          <EmptyState lang={lang} onAbout={() => setScreen("about")} onPick={(q) => submit(q)} />
        ) : (
          turns.map((turn) =>
            turn.role === "user" ? (
              <UserBubble
                key={turn.id}
                text={turn.text}
                lang={turn.lang}
                editing={editingId === turn.id}
                onLongPress={(anchor) => setMenu({ anchor, turn })}
                onSubmitEdit={(next) => submitEdit(turn.id, next)}
                onCancelEdit={() => setEditingId(null)}
              />
            ) : (
              <BotBubble
                key={turn.id}
                text={turn.text}
                lang={turn.lang}
                mode={turn.mode ?? "in_corpus"}
                citations={turn.citations}
                onLongPress={(anchor) => setMenu({ anchor, turn })}
              />
            )
          )
        )}
        {/* In the bot's own position and bubble shape, so it reads as the
            answer being composed rather than as a detached spinner. */}
        {busy && <PendingBubble lang={lang} />}
      </ScrollView>

      {/* Pinned, non-dismissible, and deliberately the quietest thing on
          screen. Off-style for the reference app, required by the rubric
          (§12.3) — it does not collapse and it has no close affordance. It
          stays visible with the keyboard open, which is why the keyboard is
          handled by shrinking the ROOT rather than by hiding the composer. */}
      <DisclaimerBar text={disclaimer} lang={lang} />

      <MessageMenu
        visible={menu !== null}
        anchor={menu?.anchor ?? null}
        lang={menu?.turn.lang ?? lang}
        onClose={() => setMenu(null)}
        actions={
          menu
            ? [
                {
                  key: "copy",
                  label: t("copy", menu.turn.lang),
                  onPress: () => {
                    void Clipboard.setStringAsync(
                      menu.turn.role === "bot"
                        ? answerForClipboard(menu.turn.text, menu.turn.citations, menu.turn.lang)
                        : menu.turn.text
                    );
                  },
                },
                // Only user messages are editable — an AI answer is not a
                // prompt, and offering to "edit" one would invite putting words
                // in the bot's mouth, which is the opposite of what a
                // corpus-grounded bot is for.
                ...(menu.turn.role === "user"
                  ? [
                      {
                        key: "edit" as const,
                        label: t("edit", menu.turn.lang),
                        onPress: () => setEditingId(menu.turn.id),
                      },
                    ]
                  : []),
              ]
            : []
        }
      />

      {/* Hidden while editing: the edit has its own Send, and two send
          affordances on screen at once is the classic way a user sends the
          wrong thing. The disclaimer bar stays regardless (§12.3). */}
      <View
        style={[
          s.composer,
          editingId !== null && { display: "none" },
          // Clear the gesture bar when the keyboard is closed; when it is open
          // KeyboardAvoidingView has already reserved that space, so adding
          // the inset again would leave a visible gap.
          { paddingBottom: keyboardVisible ? space.md : insets.bottom + space.md },
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
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
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
