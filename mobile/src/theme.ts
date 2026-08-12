/**
 * Design tokens, extracted from the real Seerat Ki Duniya app (CLAUDE.md §12).
 *
 * The single most important value here is `bg`. It is a warm cream, NOT white —
 * get that one wrong and every screen reads as a different app.
 *
 * Note the logo/UI split: the logo is teal + gold, the product chrome is green
 * + gold. Follow the chrome. Teal appears nowhere.
 */
export const color = {
  bg: "#F7F5F0", // warm cream ground, never #FFF
  band: "#F0ECE1", // tinted band: section headers, the disclaimer bar
  surface: "#FFFFFF", // cards, bubbles, chips
  primary: "#14483A", // hero fills, user bubble, active tab, headings
  primaryDeep: "#0F3D2E",
  gold: "#E0A63C", // reverence marker — source rules, refusal accent
  goldSoft: "#F5EAD3",
  text: "#1C1C1A",
  textSoft: "#82827A",
  divider: "#E6E2D8",
  onPrimary: "#F7F5F0",
  // #F5842C is the reference's one high-emphasis CTA per screen. A chat surface
  // has no such CTA, so it stays UNUSED (§12.3). Do not find it a job.
} as const;

export const radius = { card: 16, chip: 12, bubble: 18, tight: 4 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

/**
 * Urdu needs more room than English at the same rank, and MORE than that here:
 * the ﷺ ligature (U+FDFA) is tall enough to crowd the line above it in body
 * text — confirmed on device in Phase 1(c). §12.1 calls 1.7 a floor, so these
 * sit above it.
 */
export const type = {
  title: { fontSize: 22, fontWeight: "700" as const, color: color.text },
  body: { fontSize: 16, lineHeight: 25, color: color.text },
  bodyUr: { fontSize: 19, lineHeight: 38, color: color.text },
  meta: { fontSize: 13, lineHeight: 19, color: color.textSoft },
  metaUr: { fontSize: 15, lineHeight: 30, color: color.textSoft },
  chip: { fontSize: 13, fontWeight: "600" as const },
  disclaimer: { fontSize: 11.5, lineHeight: 17, color: color.textSoft },
  disclaimerUr: { fontSize: 12.5, lineHeight: 24, color: color.textSoft },
} as const;

/** The reference is near-flat: a hairline, not a shadow. */
export const flatCard = {
  backgroundColor: color.surface,
  borderRadius: radius.card,
  borderWidth: 1,
  borderColor: color.divider,
} as const;

/** The reference's distinctive tic: a dashed border where a shadow would go. */
export const dashedCard = {
  backgroundColor: "transparent",
  borderRadius: radius.card,
  borderWidth: 1,
  borderStyle: "dashed" as const,
  borderColor: color.divider,
} as const;

export const isUr = (lang: string) => lang === "ur";

/** Text style for a body string in the given language. */
export function bodyStyle(lang: string) {
  return isUr(lang)
    ? { ...type.bodyUr, textAlign: "right" as const, writingDirection: "rtl" as const }
    : { ...type.body, textAlign: "left" as const, writingDirection: "ltr" as const };
}

export function metaStyle(lang: string) {
  return isUr(lang)
    ? { ...type.metaUr, textAlign: "right" as const, writingDirection: "rtl" as const }
    : { ...type.meta, textAlign: "left" as const, writingDirection: "ltr" as const };
}
