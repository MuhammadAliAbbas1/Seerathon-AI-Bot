/**
 * THE DEMO CACHE (CLAUDE.md §5.6).
 *
 * Judging is unattended: a judge installs the APK, taps the landing screen's
 * example chips, and nobody is there to explain a 503. Those chips are the
 * four things we actively invite them to tap, so they are the four things that
 * must not depend on a provider being reachable.
 *
 * ── What this caches, and what it deliberately does NOT ────────────────────
 *
 * It caches the MODEL'S RESPONSES, not our answers.
 *
 * That distinction is the whole design. §5.6 originally specified an LRU of
 * finished responses; caching one layer lower is strictly safer, because on a
 * hit the pipeline still runs end to end and only skips the network:
 *
 *   · the ruling ratchet still fires FIRST, before anything here is consulted,
 *     so a keyword added tomorrow refuses a question this cache would have
 *     answered yesterday — §5.5's one-way ratchet cannot be overridden by a
 *     stale entry
 *   · §5.3's three citation checks re-run against the CURRENT corpus, so a
 *     cached citation whose entry lost its body text is discarded exactly as a
 *     live one would be
 *   · precedence, language detection and the fail-closed path all re-run live
 *
 * **We replay the model's judgement; our own safety logic always runs.**
 * That is the answer if anyone asks whether the demo was staged.
 *
 * It also makes a hand-written answer structurally impossible rather than
 * merely forbidden. There is nowhere to put one: entries are raw provider
 * envelopes recorded from real calls, and anything hand-authored would have to
 * survive validation it was never produced by.
 *
 * ── Why the adversarial fixtures are NOT wired in here ─────────────────────
 *
 * There are 37 recorded fixtures sitting in `api/fixtures/` that would cost
 * nothing to allowlist, and someone will eventually notice and wonder.
 *
 * The distinction is between what we INVITE and what a judge CHOOSES. The
 * chips are our invitation, so pre-seeding them is demo preparation. The
 * adversarial questions are what a judge thinks of themselves, and those are
 * the actual test — they must hit the live system, or a green result proves
 * nothing about the deployment a judge is holding. The more of the demo is a
 * recording, the less any of it tells them.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./config.ts";
import { loadCorpus } from "./corpus.ts";
import { PROMPT_VERSION_BY_OP, SCHEMA_VERSION_BY_OP } from "./prompts.ts";
import { fixtureKey } from "./providers/fixtures.ts";
import type { LlmProvider, ProviderOutcome } from "./providers/types.ts";

export const DEMO_CACHE_PATH = join(REPO_ROOT, "demo-cache.json");

/**
 * What the cache was built against. If ANY of this has moved, the whole file
 * is refused.
 *
 * Whole-file, not per-entry, and that is deliberate: partial validity is the
 * harder thing to reason about, and a cache that is 80% valid fails on exactly
 * the entries nobody checked. An all-or-nothing gate has one state to verify.
 */
export interface DemoCacheGate {
  corpusVersion: string;
  provider: string;
  classifyModel: string;
  answerModel: string;
  classifyPromptVersion: string;
  answerPromptVersion: string;
  classifySchemaVersion: string;
  answerSchemaVersion: string;
}

export interface DemoCacheFile {
  gate: DemoCacheGate;
  builtAt: string;
  /** Human-readable index of what is in here. Not load-bearing. */
  questions: Array<{ label: string; question: string; language: string; ops: string[] }>;
  /** fixtureKey → the raw recorded provider outcome. */
  entries: Record<string, ProviderOutcome>;
}

export function expectedGate(provider: LlmProvider): DemoCacheGate {
  return {
    corpusVersion: loadCorpus().corpusVersion,
    provider: provider.id,
    classifyModel: provider.classifyModel,
    answerModel: provider.answerModel,
    classifyPromptVersion: PROMPT_VERSION_BY_OP.classify,
    answerPromptVersion: PROMPT_VERSION_BY_OP.answer,
    classifySchemaVersion: SCHEMA_VERSION_BY_OP.classify,
    answerSchemaVersion: SCHEMA_VERSION_BY_OP.answer,
  };
}

export type GateResult =
  | { usable: true; entries: number }
  | { usable: false; reason: string; entries: 0 };

/** Compares every field and names the FIRST mismatch, so a refusal is diagnosable. */
export function checkGate(file: DemoCacheFile, expected: DemoCacheGate): GateResult {
  for (const k of Object.keys(expected) as Array<keyof DemoCacheGate>) {
    if (file.gate?.[k] !== expected[k]) {
      return {
        usable: false,
        entries: 0,
        reason: `${k}: cache has ${JSON.stringify(file.gate?.[k])}, runtime has ${JSON.stringify(expected[k])}`,
      };
    }
  }
  return { usable: true, entries: Object.keys(file.entries ?? {}).length };
}

export function readDemoCache(): DemoCacheFile | null {
  if (!existsSync(DEMO_CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(DEMO_CACHE_PATH, "utf8")) as DemoCacheFile;
  } catch {
    // A corrupt cache is a missing cache. It must never take the service down —
    // this whole mechanism exists to make the demo MORE robust, so it may not
    // become a new way for it to fail.
    return null;
  }
}

export interface DemoCacheStatus {
  present: boolean;
  usable: boolean;
  entries: number;
  reason?: string;
}

/**
 * Wraps a provider so curated questions are served from recorded responses.
 *
 * A miss falls through to the live provider, exactly as before. The cache can
 * only ever REMOVE network calls; it can never change what the pipeline
 * concludes, because everything downstream of the provider still runs.
 */
export function withDemoCache(
  inner: LlmProvider,
  /** Explicit seam for tests, so they never depend on a file on disk. */
  fileOverride?: DemoCacheFile | null
): { provider: LlmProvider; status: DemoCacheStatus } {
  const file = fileOverride !== undefined ? fileOverride : readDemoCache();
  if (!file) {
    return { provider: inner, status: { present: false, usable: false, entries: 0 } };
  }

  const gate = checkGate(file, expectedGate(inner));
  if (!gate.usable) {
    // Loud, once, at boot. A silently-ignored demo cache is worse than none:
    // it looks like insurance and is not.
    console.warn(`[demo-cache] REFUSED — ${gate.reason}. Every question will go live.`);
    return { provider: inner, status: { present: true, usable: false, entries: 0, reason: gate.reason } };
  }

  const lookup = (op: "classify" | "answer", model: string, question: string, language: string) =>
    file.entries[fixtureKey({ op, provider: inner.id, model, question, language })] ?? null;

  const provider: LlmProvider = {
    id: inner.id,
    classifyModel: inner.classifyModel,
    answerModel: inner.answerModel,
    async classify(req) {
      const hit = lookup("classify", inner.classifyModel, req.question, req.language);
      if (hit?.ok) return { ...hit, fromCache: true };
      return inner.classify(req);
    },
    async answer(req) {
      const hit = lookup("answer", inner.answerModel, req.question, req.language);
      if (hit?.ok) return { ...hit, fromCache: true };
      return inner.answer(req);
    },
  };

  console.log(`[demo-cache] loaded — ${gate.entries} entries, corpus ${file.gate.corpusVersion}`);
  return { provider, status: { present: true, usable: true, entries: gate.entries } };
}

/** Stable id for a cache build, so two builds are comparable. Diagnostic only. */
export function gateFingerprint(gate: DemoCacheGate): string {
  return createHash("sha256").update(JSON.stringify(gate), "utf8").digest("hex").slice(0, 12);
}
