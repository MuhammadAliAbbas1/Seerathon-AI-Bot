/**
 * The demo cache (§5.6).
 *
 * What these pin is not "does it return the right string" — it is the claim
 * the whole design rests on: **we replay the model's judgement; our own safety
 * logic always runs.** If that stops being true the cache becomes a way to
 * serve an answer the live pipeline would now refuse, which is worse than
 * having no cache at all.
 */
import { strict as assert } from "node:assert";
import { before, describe, it } from "node:test";
import { ask } from "../src/ask.ts";
import { checkGate, expectedGate, withDemoCache } from "../src/demo-cache.ts";
import type { DemoCacheFile, DemoCacheGate } from "../src/demo-cache.ts";
import { fixtureKey } from "../src/providers/fixtures.ts";
import { ID_BOTH, ID_GHOST, installFakeCorpus } from "./helpers.ts";
import type { LlmProvider, ProviderOutcome } from "../src/providers/types.ts";

before(() => installFakeCorpus());

const MODELS = { classify: "gemini-2.5-flash-lite", answer: "gemini-2.5-flash" };

/** A provider that fails loudly on any live call, so a cache miss is visible. */
function deadProvider(onCall: () => void = () => {}): LlmProvider {
  return {
    id: "gemini",
    classifyModel: MODELS.classify,
    answerModel: MODELS.answer,
    async classify() {
      onCall();
      return { ok: false, failure: "transport", detail: "live call" };
    },
    async answer() {
      onCall();
      return { ok: false, failure: "transport", detail: "live call" };
    },
  };
}

function entryFor(op: "classify" | "answer", question: string, language: string, data: unknown) {
  const key = fixtureKey({ op, provider: "gemini", model: MODELS[op], question, language });
  return [key, { ok: true, data, raw: {} } as ProviderOutcome] as const;
}

/** Builds an in-memory cache file whose gate matches the current runtime. */
function cacheFor(pairs: Array<readonly [string, ProviderOutcome]>, gate?: Partial<DemoCacheGate>): DemoCacheFile {
  return {
    gate: { ...expectedGate(deadProvider()), ...gate },
    builtAt: new Date().toISOString(),
    questions: [],
    entries: Object.fromEntries(pairs),
  };
}

describe("demo cache — the gate", () => {
  it("a matching gate is usable", () => {
    const g = expectedGate(deadProvider());
    assert.equal(checkGate(cacheFor([]), g).usable, true);
  });

  it("a corpus version bump refuses the WHOLE file", () => {
    const g = expectedGate(deadProvider());
    const r = checkGate(cacheFor([], { corpusVersion: "0.9.0" }), g);
    assert.equal(r.usable, false);
    assert.equal(r.entries, 0, "a refused cache must expose no entries at all");
    assert.match((r as { reason: string }).reason, /corpusVersion/);
  });

  it("a prompt version bump refuses it", () => {
    const r = checkGate(cacheFor([], { classifyPromptVersion: "router-v0" }), expectedGate(deadProvider()));
    assert.equal(r.usable, false);
    assert.match((r as { reason: string }).reason, /classifyPromptVersion/);
  });

  it("a different model refuses it", () => {
    const r = checkGate(cacheFor([], { answerModel: "some-other-model" }), expectedGate(deadProvider()));
    assert.equal(r.usable, false);
  });

  it("a different provider refuses it", () => {
    const r = checkGate(cacheFor([], { provider: "openrouter" }), expectedGate(deadProvider()));
    assert.equal(r.usable, false);
  });
});

describe("demo cache — our safety logic still runs on a hit", () => {
  /**
   * THE test. A cached answer for a question that the ratchet now catches must
   * be refused, not served.
   *
   * The ratchet is a one-way escalation (§5.5) and may only ever move toward
   * refusal. If a keyword is added tomorrow that matches a question cached
   * today, the cache must lose. It does — structurally, because the ratchet
   * runs inside `route()` before the provider is ever consulted, and the cache
   * lives at the provider layer beneath it.
   */
  it("the ruling ratchet beats a cached in_corpus answer", async () => {
    const q = "Is it sunnah to eat with the right hand?";
    const lang = "en";
    let liveCalls = 0;

    const file = cacheFor([
      entryFor("classify", q, lang, { mode: "in_corpus", candidateIds: [ID_BOTH] }),
      entryFor("answer", q, lang, { answer: "A cached answer that must never be served.", citations: [ID_BOTH] }),
    ]);

    const provider = installCache(file, deadProvider(() => liveCalls++));
    const r = await ask(q, { provider });

    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.mode, "ruling_seeking", "the ratchet must win over a cached in_corpus response");
    assert.equal(r.reason, "keyword-ratchet");
    assert.equal(r.citations.length, 0);
    assert.equal(liveCalls, 0, "and it must do so without any provider call");
    assert.equal(r.servedFrom, "none", "no model was consulted — that is not the same claim as 'live'");
  });

  /**
   * §5.3 re-runs against the CURRENT corpus, so a cached citation whose entry
   * no longer validates is discarded exactly as a live one would be.
   */
  it("a cached answer citing a non-existent entry is discarded, not served", async () => {
    const q = "What was the Prophet's character like?";
    const lang = "en";

    const file = cacheFor([
      entryFor("classify", q, lang, { mode: "in_corpus", candidateIds: [ID_BOTH] }),
      entryFor("answer", q, lang, { answer: "Grounded-looking prose.", citations: [ID_GHOST] }),
    ]);

    const r = await ask(q, { provider: installCache(file, deadProvider()) });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.mode, "out_of_corpus", "§5.3 must discard the whole answer");
    assert.equal(r.reason, "citations-invalid");
    assert.equal(r.citations.length, 0);
  });

  it("a cached classification naming a non-existent entry collapses to the fallback", async () => {
    const q = "Something the cache thinks is covered";
    const lang = "en";
    const file = cacheFor([entryFor("classify", q, lang, { mode: "in_corpus", candidateIds: [ID_GHOST] })]);

    const r = await ask(q, { provider: installCache(file, deadProvider()) });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.mode, "out_of_corpus");
    assert.equal(r.reason, "no-valid-candidates");
  });
});

describe("demo cache — the diagnostic may not lie", () => {
  it("a fully cached answer reports servedFrom: cache", async () => {
    const q = "A cached question";
    const file = cacheFor([
      entryFor("classify", q, "en", { mode: "in_corpus", candidateIds: [ID_BOTH] }),
      entryFor("answer", q, "en", { answer: "Cached prose.", citations: [ID_BOTH] }),
    ]);
    const r = await ask(q, { provider: installCache(file, deadProvider()) });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.servedFrom, "cache");
  });

  /**
   * Regression. `fromCache` was originally set only on the in_corpus return
   * path, so a cached out_of_corpus refusal reported `servedFrom: "live"` —
   * the diagnostic claiming a provider call that never happened. A field whose
   * whole purpose is telling the truth about our own state cannot be allowed
   * to be wrong on the refusal paths, which are three of the four behaviours.
   */
  it("a cached REFUSAL reports cache, not live", async () => {
    const q = "Who won the 2022 World Cup?";
    const file = cacheFor([entryFor("classify", q, "en", { mode: "out_of_corpus", candidateIds: [] })]);
    const r = await ask(q, { provider: installCache(file, deadProvider()) });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.mode, "out_of_corpus");
    assert.equal(r.servedFrom, "cache", "it was replayed — saying 'live' would be a false claim");
  });

  it("an uncached question still reports live", async () => {
    const r = await ask("A question nothing has recorded", { provider: installCache(cacheFor([]), deadProvider()) });
    assert.equal(r.ok, false, "a dead provider on a miss is a system failure, not a refusal");
  });
});

describe("demo cache — absent or refused is not a failure mode", () => {
  it("a refused cache falls through to live rather than throwing", async () => {
    const file = cacheFor([entryFor("classify", "q", "en", { mode: "out_of_corpus", candidateIds: [] })], {
      corpusVersion: "0.0.1",
    });
    let calls = 0;
    const r = await ask("q", { provider: installCache(file, deadProvider(() => calls++)) });
    assert.equal(calls, 1, "the gate refused, so the question must go live");
    assert.equal(r.ok, false);
  });
});

/**
 * `withDemoCache` reads from disk by default; these tests must not depend on a
 * real `demo-cache.json` existing, or on what happens to be in it. The wrapper
 * takes an explicit file override for exactly this.
 */
function installCache(file: DemoCacheFile, inner: LlmProvider): LlmProvider {
  return withDemoCache(inner, file).provider;
}
