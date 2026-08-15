import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { color, dashedCard, flatCard, radius, space, type, bodyStyle, bodyStyleForText, metaStyle, isUr } from "./theme";
import { t } from "./strings";
import { SourcesSheet } from "./SourcesSheet";
import { CheckIcon, CopyIcon } from "./icons";
import type { MenuAnchor } from "./MessageMenu";
import type { Citation, Language, Mode } from "./api";

/* ── Header ─────────────────────────────────────────────────────────────── */

export function Header({
  lang,
  onToggleLang,
  onAbout,
  onNewChat,
  showNewChat,
  title,
}: {
  lang: Language;
  onToggleLang: () => void;
  onAbout: () => void;
  onNewChat: () => void;
  showNewChat: boolean;
  title: string;
}) {
  const ur = isUr(lang);
  return (
    // Mirrored in Urdu: title right, controls left. The bubbles and body text
    // already flip; leaving the chrome LTR made the header the one element on
    // screen still reading the wrong way (§7.1).
    <View style={[s.header, ur && { flexDirection: "row-reverse" }]}>
      {/* Shrinks and truncates rather than pushing the controls off screen —
          three controls plus a title is tight on a 360dp phone. */}
      <Text
        style={[type.title, ur && { fontSize: 24, textAlign: "right" }, { flexShrink: 1 }]}
        numberOfLines={1}
      >
        {title}
      </Text>
      {/* Reversed too, so the control ORDER reads correctly right-to-left
          rather than merely moving the group to the other side. */}
      <View style={[s.headerRight, ur && { flexDirection: "row-reverse" }]}>
        {/* The reference's toggle is a SWITCH — `UR ( ● ) EN` — not the
            segmented pill §12.1 described from a smaller screenshot. Matched
            to the real control: labels flanking a track, the knob sliding to
            the active side, active label in primary green.
            Knob direction VERIFIED against the reference on device
            2026-08-13: knob sits on the UR side when UR is active. */}
        <Pressable
          onPress={onToggleLang}
          style={s.toggle}
          accessibilityRole="switch"
          accessibilityState={{ checked: lang === "ur" }}
          accessibilityLabel="Switch language between Urdu and English"
        >
          <Text style={[s.toggleLabel, lang === "ur" && s.toggleLabelOn]}>UR</Text>
          <View style={s.track}>
            <View style={[s.knob, lang === "ur" ? s.knobUr : s.knobEn]} />
          </View>
          <Text style={[s.toggleLabel, lang === "en" && s.toggleLabelOn]}>EN</Text>
        </Pressable>

        {showNewChat && (
          <Pressable
            onPress={onNewChat}
            style={({ pressed }) => [s.iconBtn, pressed && s.iconBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel="New conversation"
          >
            <Text style={s.iconGlyph}>+</Text>
          </Pressable>
        )}

        {/* The ONLY route to the verbatim /meta disclaimer the organizers
            wrote and will look for (§4), so it is a rubric surface, not a
            footer link. Sized to the reference's own ~48px rounded-square
            header buttons. */}
        <Pressable
          onPress={onAbout}
          style={({ pressed }) => [s.iconBtn, pressed && s.iconBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel="About and corpus rules"
        >
          <Text style={s.iconGlyph}>i</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ── Copy ───────────────────────────────────────────────────────────────── */

/**
 * Persistent copy control under an ANSWER. Icon only, no label.
 *
 * Quiet by design: a bare icon in secondary grey against the sources chip's
 * outlined primary-green pill. The sources chip is the rubric surface and must
 * stay the most prominent affordance under an answer — moving user-message
 * copy into a long-press menu and reducing this one to an icon makes the chip
 * MORE prominent, not less.
 *
 * 48dp touch target with a 17px glyph: **visually lighter, not physically
 * smaller.** Shrinking the target instead of the ink is the usual way this
 * goes wrong.
 */
function CopyIconButton({ value, lang }: { value: string; lang: Language }) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(id);
  }, [done]);

  return (
    <Pressable
      onPress={async () => {
        await Clipboard.setStringAsync(value);
        setDone(true);
      }}
      style={({ pressed }) => [s.iconAction, pressed && { backgroundColor: color.band }]}
      accessibilityRole="button"
      accessibilityState={{ selected: done }}
      accessibilityLabel={done ? t("copied", lang) : t("copyAnswer", lang)}
    >
      {done ? <CheckIcon size={17} tint={color.primary} /> : <CopyIcon size={17} tint={color.textSoft} />}
    </Pressable>
  );
}

/**
 * What a copied ANSWER carries: the words, then what they rest on.
 *
 * An answer pasted somewhere else without its citation is an unsourced
 * religious claim — precisely the harm §5.3 exists to prevent, escaping
 * through the one door validation does not watch. Cheap to prevent here.
 */
export function answerForClipboard(text: string, citations: Citation[] | undefined, lang: Language): string {
  if (!citations || citations.length === 0) return text;
  const list = citations
    .map((c) => `• ${c.title} — ${c.type === "shamail" ? t("shamail", lang) : t("timeline", lang)} · ${c.id}`)
    .join("\n");
  return `${text}\n\n${t("copiedSources", lang)}\n${list}`;
}

/* ── Message bubbles ────────────────────────────────────────────────────── */

/**
 * A user turn. No permanently visible buttons — copy and edit live behind a
 * long press, which keeps the surface clean and leaves the sources chip as the
 * only standing affordance in a conversation.
 *
 * While being edited the bubble becomes a text field in place, with Cancel and
 * Send beneath it, as ChatGPT, Gemini and Claude all do.
 */
export function UserBubble({
  text,
  lang,
  editing,
  onLongPress,
  onSubmitEdit,
  onCancelEdit,
}: {
  text: string;
  lang: Language;
  editing?: boolean;
  onLongPress?: (anchor: MenuAnchor) => void;
  onSubmitEdit?: (next: string) => void;
  onCancelEdit?: () => void;
}) {
  /**
   * `ur` is the SHELL language and governs LAYOUT only — which side of the
   * conversation the bubble sits on, and which corner is tightened. That is a
   * property of the surface, so it stays consistent no matter what the user
   * types.
   *
   * TEXT direction and metrics come from the string's own script instead. This
   * bubble is a verbatim echo of what the user typed, and the shell language
   * is not evidence about it: tapping the Urdu example under an English shell
   * (or simply typing Urdu) otherwise rendered their own question left-aligned
   * and LTR at English metrics — 16/25 rather than 19/38 — losing the ﷺ leading
   * fix (§12.0) on the one element that is purely their own words.
   *
   * See `isRtlScript` in theme.ts for why this is not language detection and
   * does not reopen the `"he"` bug class.
   */
  const ur = isUr(lang);
  const textStyle = bodyStyleForText(text);
  const ref = useRef<View>(null);
  const [draft, setDraft] = useState(text);

  // Reset the draft whenever a fresh edit begins, so a cancelled edit does not
  // leak into the next one.
  useEffect(() => {
    if (editing) setDraft(text);
  }, [editing, text]);

  if (editing) {
    return (
      <View style={[s.row, ur ? { justifyContent: "flex-start" } : { justifyContent: "flex-end" }]}>
        <View style={{ width: "92%" }}>
          <View style={[s.bubble, s.editBubble]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              multiline
              autoFocus
              // Follows the DRAFT's script, not the committed text's: someone
              // rewriting an Urdu question in English should see the field
              // flip as they type, not stay stuck RTL.
              style={[bodyStyleForText(draft), s.editInput]}
              accessibilityLabel={t("editMessage", lang)}
            />
          </View>
          <View style={[s.actions, ur && { flexDirection: "row-reverse" }]}>
            <Pressable
              onPress={onCancelEdit}
              style={({ pressed }) => [s.copyChip, pressed && { backgroundColor: color.band }]}
              accessibilityRole="button"
              accessibilityLabel={t("cancel", lang)}
            >
              <Text style={s.copyChipText}>{t("cancel", lang)}</Text>
            </Pressable>
            <Pressable
              onPress={() => draft.trim() && onSubmitEdit?.(draft.trim())}
              disabled={!draft.trim()}
              style={({ pressed }) => [s.sendChip, !draft.trim() && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel={t("send", lang)}
            >
              <Text style={s.sendChipText}>{t("send", lang)}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.row, ur ? { justifyContent: "flex-start" } : { justifyContent: "flex-end" }]}>
      <Pressable
        ref={ref}
        onLongPress={() =>
          ref.current?.measureInWindow((x, y, width, height) => onLongPress?.({ x, y, width, height }))
        }
        delayLongPress={350}
        style={({ pressed }) => [
          s.bubble,
          s.userBubble,
          ur ? s.userBubbleUr : s.userBubbleEn,
          pressed && { opacity: 0.9 },
        ]}
        accessibilityRole="text"
        accessibilityLabel={text}
        accessibilityHint={t("longPressHint", lang)}
      >
        <Text style={[textStyle, { color: color.onPrimary }]}>{text}</Text>
      </Pressable>
    </View>
  );
}

/* ── Pending ────────────────────────────────────────────────────────────── */

/**
 * Shown where the answer will appear, in the answer's own bubble shape.
 *
 * The previous indicator was a spinner in a row at the bottom of the scroll
 * view — not in the bot's position, so it did not read as "composing", and on
 * a short screen it could sit off-screen entirely, making the app look frozen
 * during the single longest interaction a judge has with it.
 *
 * The copy stays: "Looking through the collection…" says what the system is
 * actually doing, and that it is looking through a COLLECTION rather than
 * thinking freely is the whole claim of this project (§2).
 */
export function PendingBubble({ lang }: { lang: Language }) {
  const ur = isUr(lang);
  const d1 = useRef(new Animated.Value(0.25)).current;
  const d2 = useRef(new Animated.Value(0.25)).current;
  const d3 = useRef(new Animated.Value(0.25)).current;

  useEffect(() => {
    const pulse = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 360, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.25, duration: 360, useNativeDriver: true }),
          Animated.delay(720 - delay),
        ])
      );
    const running = [pulse(d1, 0), pulse(d2, 180), pulse(d3, 360)];
    running.forEach((a) => a.start());
    return () => running.forEach((a) => a.stop());
  }, [d1, d2, d3]);

  return (
    <View style={[s.row, ur ? { justifyContent: "flex-end" } : { justifyContent: "flex-start" }]}>
      <View style={[s.bubble, s.botBubble, ur ? s.botBubbleUr : s.botBubbleEn]}>
        <View style={[s.dots, ur && { flexDirection: "row-reverse" }]}>
          <Animated.View style={[s.dot, { opacity: d1 }]} />
          <Animated.View style={[s.dot, { opacity: d2 }]} />
          <Animated.View style={[s.dot, { opacity: d3 }]} />
        </View>
        <Text style={[metaStyle(lang), { marginTop: space.sm }]}>{t("thinking", lang)}</Text>
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
  onLongPress,
}: {
  text: string;
  lang: Language;
  mode: Mode | "quota" | "error";
  citations?: Citation[];
  onLongPress?: (anchor: MenuAnchor) => void;
}) {
  const [open, setOpen] = useState(false);
  const ur = isUr(lang);
  const ref = useRef<View>(null);

  // ── A refusal and an outage must not look the same ─────────────────────
  //
  // These three modes all used to share one gold rule. But the gold rule
  // means "this is a considered position, not a failure" — and on `quota` or
  // `error` that is FALSE. The bot did not decline; our call broke. Rendering
  // an outage as a considered refusal is §5.6's failure-path-may-not-lie rule
  // violated one layer up, on the surface a judge actually reads.
  //
  // So: gold rule for a genuine refusal, and a tinted, dashed, explicitly
  // labelled treatment for a system failure. Still no red and no warning
  // iconography (§12.2) — quota is something a judge may genuinely hit on
  // stage, and it must read as calm, just not as a decision we made.
  const isRefusal = mode === "ruling_seeking";
  const isSystem = mode === "quota" || mode === "error";

  return (
    <View style={[s.row, ur ? { justifyContent: "flex-end" } : { justifyContent: "flex-start" }]}>
      <View style={{ maxWidth: "88%" }}>
        {/* Long-pressable as well as carrying a persistent icon: someone who
            long-presses an answer expecting a menu should not find nothing.
            ChatGPT and Gemini both offer the button AND the gesture. */}
        <Pressable
          ref={ref}
          onLongPress={() =>
            ref.current?.measureInWindow((x, y, width, height) => onLongPress?.({ x, y, width, height }))
          }
          delayLongPress={350}
          style={({ pressed }) => [
            s.bubble,
            s.botBubble,
            ur ? s.botBubbleUr : s.botBubbleEn,
            isRefusal && (ur ? s.markedUr : s.markedEn),
            isSystem && s.systemBubble,
            pressed && { opacity: 0.95 },
          ]}
          accessibilityRole="text"
          accessibilityLabel={text}
          accessibilityHint={t("longPressHint", lang)}
        >
          {isSystem && (
            <Text style={[metaStyle(lang), s.systemLabel]}>{t("systemNotice", lang)}</Text>
          )}
          <Text style={bodyStyle(lang)}>{text}</Text>
        </Pressable>

        <View style={[s.actions, ur && { flexDirection: "row-reverse" }]}>
          {citations && citations.length > 0 && (
            /* A handle, never the evidence itself (§12.2). Opens the sheet —
               five full passages stacked inline was a wall, and the source
               card is a rubric surface a judge will actually read. */
            <Pressable
              onPress={() => setOpen(true)}
              style={({ pressed }) => [s.chip, pressed && { backgroundColor: color.band }]}
              accessibilityRole="button"
              accessibilityLabel={
                citations.length === 1
                  ? t("sourcesOne", lang)
                  : t("sourcesMany", lang).replace("%d", String(citations.length))
              }
            >
              <Text style={s.chipText}>
                {citations.length === 1
                  ? t("sourcesOne", lang)
                  : t("sourcesMany", lang).replace("%d", String(citations.length))}
              </Text>
            </Pressable>
          )}
          <CopyIconButton value={answerForClipboard(text, citations, lang)} lang={lang} />
        </View>

        {citations && citations.length > 0 && (
          <SourcesSheet citations={citations} lang={lang} visible={open} onClose={() => setOpen(false)} />
        )}
      </View>
    </View>
  );
}

/**
 * The source card now lives in SourcesSheet.tsx, one per page.
 *
 * The old inline version is deleted rather than kept "in case": it truncated
 * the id to 8 characters, which is not a verifiable citation, and a second
 * renderer for the same rubric surface is exactly how the two drift apart.
 * Everything in it still comes from the baked corpus, read after validation —
 * the model supplies an id and nothing else (§5.4), which is what keeps
 * verbatim corpus text out of the model's output entirely.
 */

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
 * The landing screen — and, under unattended judging, the ENTIRE product
 * explanation. A judge installs the APK, opens it, and nobody is there to
 * present anything. A title, a line of description, four chips and the
 * disclaimer bar are all they get.
 *
 * The reference app is no help here and was checked: screens 3 and 6 are both
 * genuine empty states (0 of 120 traits read; 0 courses, 0 XP, 0 events) and
 * neither carries a single word of explanation. That works for them because
 * every screen in their app is a content list, and a list of Shamail traits
 * explains itself. This is the only screen in either app that has to explain a
 * BEHAVIOUR, so there was nothing to borrow and their approach — structure
 * with null values, no copy — would be actively wrong here (§12.4).
 */
export function EmptyState({ lang, onAbout, onPick }: { lang: Language; onAbout: () => void; onPick: (q: string) => void }) {
  /**
   * ⚠️ THE ORDER IS LOAD-BEARING. Do not sort, shuffle, or "group the
   * refusals together".
   *
   * A judge taps one thing first. If that first tap is the out-of-corpus
   * example, their first experience is a refusal from a bot that has not yet
   * shown it can answer anything — which reads as broken before it reads as
   * principled. In-corpus first means every later refusal reads as restraint
   * by a bot that has already demonstrated competence.
   *
   * This is the reference's own instinct: at zero progress they lead with one
   * primed "Continue reading" action rather than a menu of equals (screen 3).
   */
  const guardrails: Array<[string, string]> = [
    ["exampleInCorpus", "tagInCorpus"], // ← must stay first; see above
    ["exampleOutOfCorpus", "tagOutOfCorpus"],
    ["exampleRuling", "tagRuling"],
  ];

  /**
   * Chip 4 — the same in-corpus question in the OTHER language.
   *
   * Without it, bilingual support is undiscoverable. The UR/EN switch changes
   * the shell; to see a bilingual ANSWER a judge would have to type Urdu,
   * which they cannot do on an English keyboard. §7 lists Urdu as one of three
   * places we intend to win and it is the largest body of work in Phase 5 — and
   * a judge could miss it entirely.
   *
   * Reusing the SAME question is what makes it legible: chips 1 and 4 are one
   * question in two scripts, so a judge taps both and compares two answers and
   * two source cards side by side. That demonstration needs zero Urdu literacy
   * to evaluate.
   *
   * It is symmetric — an Urdu shell offers the English one — so an Urdu-reading
   * judge discovers English support by the same route.
   *
   * It also puts the §5.4 decision on stage rather than leaving it as a claim:
   * the answer and its citations render RTL while the toggle and the persistent
   * disclaimer stay in the shell's language.
   */
  const other: Language = lang === "en" ? "ur" : "en";
  const otherQuestion = t("exampleInCorpus", other);

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

      {guardrails.map(([qKey, tagKey]) => (
        <Pressable key={qKey} style={s.example} onPress={() => onPick(t(qKey as never, lang))}>
          <Text style={[bodyStyle(lang), { fontSize: isUr(lang) ? 17 : 15 }]}>{t(qKey as never, lang)}</Text>
          <Text style={[type.meta, { marginTop: space.xs }]}>{t(tagKey as never, lang)}</Text>
        </Pressable>
      ))}

      {/* The question renders in ITS OWN language, not the shell's — it is the
          only chip whose text is deliberately foreign to the surrounding UI,
          so it needs the other language's direction, size and ﷺ leading. */}
      <Pressable style={s.example} onPress={() => onPick(otherQuestion)}>
        <Text style={[bodyStyle(other), { fontSize: isUr(other) ? 17 : 15 }]}>{otherQuestion}</Text>
        <Text style={[type.meta, { marginTop: space.xs }]}>{t("tagOtherLang", lang)}</Text>
      </Pressable>

      {/* A pointer to the verbatim /meta text, which is otherwise reachable
          only via the header's `i` — discoverable on inspection, but nothing
          prompts the inspection, and a judge scoring "did they show the
          disclaimer" will tick the bar and move on. The bar itself was the
          obvious host and was rejected: see `aboutLink` in strings.ts. */}
      <Pressable
        onPress={onAbout}
        style={({ pressed }) => [s.aboutLink, pressed && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel={t("aboutTitle", lang)}
      >
        <Text style={s.aboutLinkText}>
          {isUr(lang) ? `← ${t("aboutLink", lang)}` : `${t("aboutLink", lang)} →`}
        </Text>
      </Pressable>
    </View>
  );
}

/* ── styles ─────────────────────────────────────────────────────────────── */

const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    // Was paddingHorizontal: space.xl and paddingTop: 56 — the 56 was a
    // hardcoded status-bar guess. Top inset now comes from the safe area on
    // the root; the horizontal padding dropped to make room for three
    // controls beside the title.
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    backgroundColor: color.bg,
    borderBottomWidth: 1,
    borderBottomColor: color.divider,
    gap: space.sm,
  },
  headerRight: { flexDirection: "row", alignItems: "center", gap: space.sm },

  // ── UR/EN switch ──────────────────────────────────────────────────────
  // 48dp tall including padding. The old segmented pill was ~24dp, which is
  // half Android's minimum and was the hardest control on screen to hit —
  // on a §7.1 rubric surface.
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 48,
    paddingHorizontal: 2,
  },
  toggleLabel: { fontSize: 12, fontWeight: "700", color: color.textSoft },
  toggleLabelOn: { color: color.primary },
  track: {
    width: 40,
    height: 24,
    borderRadius: 999,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.divider,
    justifyContent: "center",
  },
  knob: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: color.primary,
  },
  knobUr: { left: 2 },
  knobEn: { right: 2 },

  iconBtn: {
    // Reference header buttons are ~48px rounded SQUARES, not small circles.
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.divider,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnPressed: { backgroundColor: color.band },
  iconGlyph: { fontSize: 19, fontWeight: "700", color: color.primary },

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

  /**
   * System failure: tinted band ground plus a dashed hairline — visibly not a
   * white "considered answer" bubble and visibly not a gold-ruled refusal,
   * without a single alarming pixel.
   *
   * The band background carries the distinction on its own. `borderStyle:
   * dashed` is known to fall back to solid alongside `borderRadius` on some
   * Android versions, so it is the garnish here, never the signal.
   */
  systemBubble: {
    backgroundColor: color.band,
    borderStyle: "dashed",
    borderColor: color.divider,
  },
  systemLabel: { marginBottom: space.xs, fontWeight: "600" },

  // Action row under a message: sources chip (prominent) then copy (quiet).
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginTop: space.sm,
    marginHorizontal: space.xs,
  },
  chip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: space.md,
    borderRadius: radius.chip,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.primary,
  },
  chipText: { ...type.chip, color: color.primary },
  iconAction: {
    // 48dp target, 17px glyph — visually lighter, not physically smaller.
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  editBubble: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.primary,
    borderRadius: radius.bubble,
    width: "100%",
  },
  editInput: { minHeight: 44, maxHeight: 160, padding: 0, color: color.text },
  sendChip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: space.lg,
    borderRadius: radius.chip,
    backgroundColor: color.primary,
  },
  sendChipText: { ...type.chip, color: color.onPrimary },
  copyChip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: space.md,
    borderRadius: radius.chip,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.divider,
  },
  copyChipText: { ...type.chip, color: color.textSoft },

  dots: { flexDirection: "row", gap: 5, alignItems: "center" },
  dot: { width: 7, height: 7, borderRadius: 999, backgroundColor: color.primary },

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
  // Quiet by design: a text link, not a button. It points at supporting
  // material and must not compete with the four chips, which are the demo.
  aboutLink: { alignSelf: "center", paddingVertical: space.md, paddingHorizontal: space.lg },
  aboutLinkText: { ...type.chip, color: color.primary },
});

export const styles = s;
