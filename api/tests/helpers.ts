import { __setCorpusForTests } from "../src/corpus.ts";
import type { Corpus } from "../src/corpus.ts";
import type { LlmProvider, ProviderOutcome } from "../src/providers/types.ts";

/**
 * A tiny fake corpus with deliberately awkward entries, so §5.3's three checks
 * have something real to bite on:
 *
 *   BOTH  — body in both languages (the normal case)
 *   ENONLY— body in English only   (citing it for an Urdu answer must fail)
 *   URONLY— body in Urdu only      (mirror case)
 *   EMPTY — exists but has no body at all (existence is not content)
 */
export const ID_BOTH = "aaaaaaaaaaaaaaaaaaaaaaa1";
export const ID_EN_ONLY = "aaaaaaaaaaaaaaaaaaaaaaa2";
export const ID_UR_ONLY = "aaaaaaaaaaaaaaaaaaaaaaa3";
export const ID_EMPTY = "aaaaaaaaaaaaaaaaaaaaaaa4";
export const ID_GHOST = "ffffffffffffffffffffffff"; // never in the corpus

function entry(id: string, en: boolean, ur: boolean) {
  return {
    id,
    type: "shamail" as const,
    hasBody: { en, ur },
    en: { title: `EN ${id}` },
    ur: { title: `UR ${id}` },
  };
}

export const FAKE_INDEX = "# id | kind | group | en | ur | extra | body\n(test index)";

export function installFakeCorpus(): void {
  const corpus: Corpus = {
    corpusVersion: "test",
    builtAt: "1970-01-01T00:00:00.000Z",
    counts: {},
    disclaimer: { en: "", ur: "" },
    usageRules: { en: [], ur: [] },
    index: FAKE_INDEX,
    byId: {
      [ID_BOTH]: entry(ID_BOTH, true, true),
      [ID_EN_ONLY]: entry(ID_EN_ONLY, true, false),
      [ID_UR_ONLY]: entry(ID_UR_ONLY, false, true),
      [ID_EMPTY]: entry(ID_EMPTY, false, false),
    },
  };
  __setCorpusForTests(corpus);
}

/**
 * A provider that returns exactly what the test tells it to, without touching
 * the network. This is the whole point: the router's failure paths are driven
 * by hand-written envelopes, so the suite costs zero quota and can produce
 * shapes a live API would never give us on demand.
 */
export function fakeProvider(outcome: ProviderOutcome | (() => Promise<never>)): LlmProvider {
  return {
    id: "fake",
    classifyModel: "fake-classify",
    answerModel: "fake-answer",
    classify: typeof outcome === "function"
      ? (outcome as () => Promise<never>)
      : () => Promise.resolve(outcome),
    answer: () => Promise.resolve({ ok: false, failure: "http", detail: "n/a" } as ProviderOutcome),
  };
}

/** Shorthand: a provider that returns a successful parse of `data`. */
export function respondsWith(data: unknown): LlmProvider {
  return fakeProvider({ ok: true, data, raw: { fake: true } });
}
