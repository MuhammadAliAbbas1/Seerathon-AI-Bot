import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { color, flatCard, isUr, radius, space, type } from "./theme";
import { t } from "./strings";
import { CopyIcon, PencilIcon } from "./icons";
import type { Language } from "./api";

/**
 * Long-press context menu for a message.
 *
 * ── RTL correctness comes from the anchor, not from mirroring ─────────────
 *
 * The menu is aligned to the pressed bubble's OWN edge — the side the bubble
 * already sits on. In LTR a user bubble is right-aligned so the menu hangs
 * right; in RTL the same bubble is left-aligned and the menu follows it. No
 * direction is computed and no branch can be wrong, because the bubble has
 * already resolved the question.
 *
 * ── Not in the reference ──────────────────────────────────────────────────
 *
 * Their app has no context menu and no copy affordance anywhere (§12.4), so
 * this is a new surface assembled from their vocabulary: the flat card with a
 * hairline border, 16px radius, primary-green labels, ~48dp rows.
 */

export interface MenuAnchor {
  /** Window coordinates of the pressed bubble. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MenuAction {
  key: "copy" | "edit";
  label: string;
  onPress: () => void;
}

const MENU_WIDTH = 188;
const ROW_HEIGHT = 48;

export function MessageMenu({
  visible,
  anchor,
  actions,
  lang,
  onClose,
}: {
  visible: boolean;
  anchor: MenuAnchor | null;
  actions: MenuAction[];
  lang: Language;
  onClose: () => void;
}) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const ur = isUr(lang);

  if (!anchor) return null;

  const menuHeight = actions.length * ROW_HEIGHT + space.sm * 2;

  // Follow the bubble's own edge. Trailing edge in LTR, leading edge in RTL —
  // both expressed as "the side the bubble is already on".
  let left = ur ? anchor.x : anchor.x + anchor.width - MENU_WIDTH;
  left = Math.max(space.md, Math.min(left, screenW - MENU_WIDTH - space.md));

  // Below the bubble, unless that would run off the bottom — then above it.
  const below = anchor.y + anchor.height + space.sm;
  const top = below + menuHeight > screenH - space.xl ? Math.max(space.xl, anchor.y - menuHeight - space.sm) : below;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Outside tap dismisses. */}
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel={t("close", lang)} />
      <View style={[s.menu, { left, top, width: MENU_WIDTH }]}>
        {actions.map((a, i) => (
          <Pressable
            key={a.key}
            onPress={() => {
              onClose();
              a.onPress();
            }}
            style={({ pressed }) => [
              s.row,
              ur && { flexDirection: "row-reverse" },
              i > 0 && s.rowDivider,
              pressed && { backgroundColor: color.band },
            ]}
            accessibilityRole="button"
            accessibilityLabel={a.label}
          >
            {a.key === "copy" ? (
              <CopyIcon size={18} tint={color.primary} />
            ) : (
              <PencilIcon size={18} tint={color.primary} />
            )}
            <Text style={[type.chip, { color: color.text, fontSize: 15 }]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(28,28,26,0.18)" },
  menu: {
    position: "absolute",
    ...flatCard,
    borderRadius: radius.card,
    paddingVertical: space.sm,
    // The reference is near-flat, but a floating menu needs to read as
    // detached from the content beneath it — the lightest elevation that does
    // that, and no more.
    shadowColor: "#1C1C1A",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    height: ROW_HEIGHT,
    paddingHorizontal: space.lg,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: color.divider },
});
