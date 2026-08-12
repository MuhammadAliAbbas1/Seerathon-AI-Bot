// ── Why this is an IMPORT and not a readFileSync ──────────────────────────
// The corpus is baked at build time (§5.4), so on a server it has to arrive
// inside the deployment bundle. Vercel traces a function's files statically,
// and `readFileSync(join(REPO_ROOT, …))` is invisible to that tracer — the
// path is computed at runtime from import.meta.url, so corpus.json would
// simply not be uploaded, and the first question in production would crash on
// ENOENT. A static import is a dependency the bundler can see, so inclusion is
// guaranteed rather than hoped for, and the path is resolved at build time
// instead of being reconstructed from a directory layout that deployment
// changes underneath us.
//
// Requires "resolveJsonModule" in tsconfig.json. Verified under Node 24's
// native type-stripping and under tsc.
import corpusJson from "../../corpus.json" with { type: "json" };
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

/**
 * Baked at build time, so this is a module lookup — not a fetch, and no longer
 * even a disk read (§5.4). Still routed through a function with a `cached`
 * slot so __setCorpusForTests can swap in a fake.
 */
export function loadCorpus(): Corpus {
  if (!cached) {
    cached = corpusJson as unknown as Corpus;
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
