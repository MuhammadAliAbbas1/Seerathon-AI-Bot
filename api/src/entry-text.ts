import { getEntry } from "./corpus.ts";
import type { CorpusEntry } from "./corpus.ts";
import type { Language } from "./types.ts";

/**
 * Rendering corpus entries into (a) grounding material for the prompt and
 * (b) the text a source card shows.
 *
 * These are deliberately different functions with different jobs. The prompt
 * gets everything we have; the source card gets the substantive quote. Both
 * read from the baked corpus — never from model output (§5.4).
 */

/** Belt-and-braces bound so five long hikayat cannot blow up the prompt. */
const MAX_BODY_CHARS_PER_ENTRY = 6000;

function block(entry: CorpusEntry, language: Language): Record<string, unknown> {
  return (entry[language] ?? {}) as Record<string, unknown>;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/**
 * Everything we know about an entry, for the ANSWER PROMPT.
 *
 * Includes `hikayat` — it is on 120/120 shamail entries in both languages and
 * is the only body some entries have (§4B). It is also the depth that makes an
 * answer worth reading rather than a title restated.
 */
export function entryBodyForPrompt(entry: CorpusEntry, language: Language): string {
  const b = block(entry, language);
  const parts: string[] = [];

  if (entry.type === "shamail") {
    const tarjama = str(b.hadeesTarjama);
    const hawala = str(b.hadeesHawala);
    const points = arr(b.points);
    const hikayat = str(b.hikayat);
    if (tarjama) parts.push(`Narration: ${tarjama}${hawala ? ` ${hawala}` : ""}`);
    if (points.length) parts.push(`Lessons:\n${points.map((p) => `- ${p}`).join("\n")}`);
    if (hikayat) parts.push(`Background: ${hikayat}`);
  } else {
    const content = Array.isArray(b.content) ? (b.content as Array<Record<string, unknown>>) : [];
    const age = str(entry.umarMubarakLabel);
    const date = str(entry.gregorianDateLabel);
    const when = [age ? `age ${age}` : "", date].filter(Boolean).join(", ");
    if (when) parts.push(`When: ${when}`);
    for (const c of content) {
      const t = str(c.title);
      const body = str(c.contentText);
      if (body) parts.push(t ? `${t}\n${body}` : body);
    }
  }

  const joined = parts.join("\n\n");
  return joined.length > MAX_BODY_CHARS_PER_ENTRY
    ? joined.slice(0, MAX_BODY_CHARS_PER_ENTRY) + "\n[…]"
    : joined;
}

/**
 * The text a SOURCE CARD shows. Shorter and more quotable than the prompt
 * version: the narration if there is one, else the lessons, else the
 * background.
 *
 * This is the only verbatim corpus text that ever reaches the user, and it
 * comes from the cache — the model never produces it (§5.4).
 */
export function entryTextForCitation(entry: CorpusEntry, language: Language): string {
  const b = block(entry, language);

  if (entry.type === "shamail") {
    const tarjama = str(b.hadeesTarjama);
    const hawala = str(b.hadeesHawala);
    if (tarjama) return hawala ? `${tarjama} ${hawala}` : tarjama;
    const points = arr(b.points);
    if (points.length) return points.join(" ");
    return str(b.hikayat);
  }

  const content = Array.isArray(b.content) ? (b.content as Array<Record<string, unknown>>) : [];
  for (const c of content) {
    const body = str(c.contentText);
    if (body) return body;
  }
  return "";
}

export function entryTitle(entry: CorpusEntry, language: Language): string {
  return str(block(entry, language).title);
}

export interface PromptEntry {
  id: string;
  title: string;
  body: string;
}

/** Builds the prompt payload for a set of candidate ids, skipping anything unusable. */
export function buildPromptEntries(ids: readonly string[], language: Language): PromptEntry[] {
  const out: PromptEntry[] = [];
  for (const id of ids) {
    const e = getEntry(id);
    if (!e || !e.hasBody[language]) continue;
    const body = entryBodyForPrompt(e, language);
    if (!body) continue;
    out.push({ id, title: entryTitle(e, language), body });
  }
  return out;
}
