import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./config.ts";
import type { Language } from "./types.ts";

export interface CorpusEntry {
  id: string;
  type: "shamail" | "timeline";
  hasBody: { en: boolean; ur: boolean };
  en: Record<string, unknown> & { title: string };
  ur: Record<string, unknown> & { title: string };
  [k: string]: unknown;
}

export interface Corpus {
  corpusVersion: string;
  builtAt: string;
  counts: Record<string, number>;
  disclaimer: { en: string; ur: string };
  usageRules: { en: string[]; ur: string[] };
  index: string;
  byId: Record<string, CorpusEntry>;
}

let cached: Corpus | null = null;

/** Loaded once and held. Baked at build time, so this is a file read, not a fetch (§5.4). */
export function loadCorpus(): Corpus {
  if (!cached) {
    cached = JSON.parse(readFileSync(join(REPO_ROOT, "corpus.json"), "utf8")) as Corpus;
  }
  return cached;
}

/** Test seam — lets the offline suite swap in a tiny fake corpus. */
export function __setCorpusForTests(c: Corpus | null): void {
  cached = c;
}

export function getEntry(id: string): CorpusEntry | undefined {
  return loadCorpus().byId[id];
}

/**
 * §5.3 checks 1 and 2+3 combined, for a single id.
 *
 *   1. the id exists in the baked corpus
 *   2. the entry has body text — existence is not content
 *   3. …in the language we are about to answer in, because coverage is not
 *      symmetric between en and ur
 *
 * Reads the computed hasBody flags rather than a hardcoded list of known-empty
 * ids, so it stays correct when the corpus or our bake options change.
 */
export function isCitable(id: string, language: Language): boolean {
  const e = getEntry(id);
  return !!e && e.hasBody[language] === true;
}

/** Keeps only ids that pass isCitable. Order is preserved; duplicates dropped. */
export function filterCitable(ids: readonly string[], language: Language): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || seen.has(id)) continue;
    seen.add(id);
    if (isCitable(id, language)) out.push(id);
  }
  return out;
}
