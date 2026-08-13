import { StyleSheet, View } from "react-native";
import { color } from "./theme";

/**
 * Hand-drawn icons, no icon dependency.
 *
 * `@expo/vector-icons` is not installed and was not added (§9). Copy and check
 * draw cleanly from plain Views at these sizes. The pencil is the only shape
 * that would suffer from being approximated — and it appears ONLY inside the
 * long-press menu beside the text label "Edit", so it supports recognition
 * rather than carrying it alone. That is what makes hand-drawing acceptable
 * here and would not if it stood by itself.
 *
 * All three take a `tint` so the same glyph can be quiet under an answer and
 * full-strength inside a menu.
 */

/** Two overlapping rounded squares — the universal copy affordance. */
export function CopyIcon({ size = 17, tint = color.textSoft }: { size?: number; tint?: string }) {
  const s = size;
  const box = s * 0.72;
  return (
    <View style={{ width: s, height: s }}>
      {/* Back sheet, offset up-and-trailing. */}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: s - box,
          width: box,
          height: box,
          borderWidth: 1.6,
          borderColor: tint,
          borderRadius: 3,
        }}
      />
      {/* Front sheet, drawn over it with a matching ground so the overlap
          reads as two separate sheets rather than a grid. */}
      <View
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: box,
          height: box,
          borderWidth: 1.6,
          borderColor: tint,
          borderRadius: 3,
          backgroundColor: color.surface,
        }}
      />
    </View>
  );
}

/** Tick, for the copied-confirmation state. */
export function CheckIcon({ size = 17, tint = color.primary }: { size?: number; tint?: string }) {
  return (
    <View style={{ width: size, height: size, justifyContent: "center", alignItems: "center" }}>
      <View
        style={{
          width: size * 0.34,
          height: size * 0.62,
          borderRightWidth: 2,
          borderBottomWidth: 2,
          borderColor: tint,
          transform: [{ rotate: "45deg" }, { translateY: -size * 0.06 }],
        }}
      />
    </View>
  );
}

/** Pencil — a shaft on the diagonal with a tapered tip. Always labelled. */
export function PencilIcon({ size = 17, tint = color.text }: { size?: number; tint?: string }) {
  return (
    <View style={{ width: size, height: size, justifyContent: "center", alignItems: "center" }}>
      <View style={{ transform: [{ rotate: "45deg" }], alignItems: "center" }}>
        {/* Eraser end */}
        <View style={{ width: size * 0.3, height: size * 0.18, backgroundColor: tint, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
        {/* Shaft */}
        <View style={{ width: size * 0.3, height: size * 0.42, borderWidth: 1.5, borderColor: tint, borderTopWidth: 0, borderBottomWidth: 0 }} />
        {/* Tip: a triangle made from collapsed borders. */}
        <View
          style={{
            width: 0,
            height: 0,
            borderLeftWidth: size * 0.15,
            borderRightWidth: size * 0.15,
            borderTopWidth: size * 0.22,
            borderLeftColor: "transparent",
            borderRightColor: "transparent",
            borderTopColor: tint,
          }}
        />
      </View>
    </View>
  );
}

export const iconStyles = StyleSheet.create({});
