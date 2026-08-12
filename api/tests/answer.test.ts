import { strict as assert } from "node:assert";
import { before, describe, it } from "node:test";
import { ask } from "../src/ask.ts";
import { handleAsk } from "../src/http.ts";
import { parseGeminiBody } from "../src/providers/gemini.ts";
import * as S from "../src/strings.ts";
import {
  ID_BOTH,
  ID_EMPTY,
  ID_EN_ONLY,
  ID_GHOST,
  ID_UR_ONLY,
  installFakeCorpus,
} from "./helpers.ts";
import type { LlmProvider, ProviderOutcome } from "../src/providers/types.ts";

before(() => installFakeCorpus());

/** A provider with independently scripted classify and answer stages. */
function twoStage(classify: ProviderOutcome, answer: ProviderOutcome | Error): LlmProvider {
  return {
    id: "fake",
    classifyModel: "c",
    answerModel: "a",
    classify: () => Promise.resolve(classify),
    answer: () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)),
  };
}

const routed = (ids: string[]): ProviderOutcome => ({
  ok: true,
  data: { mode: "in_corpus", candidateIds: ids },
  raw: {},
});
const answered = (answer: string, citations: unknown): ProviderOutcome => ({
  ok: true,
  data: { answer, citations },
  raw: {},
});

const Q = "What was his character like?";

describe("answer path — happy", () => {
  it("returns the answer with citations read from the CACHE, not the model", async () => {
    const r = await ask(Q, {
      provider: twoStage(routed([ID_BOTH]), answered("He was gentle and forgiving.", [ID_BOTH])),
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.mode, "in_corpus");
    assert.equal(r.answer, "He was gentle and forgiving.");
    assert.equal(r.citations.length, 1);
    // The model supplied only an id; every other field came from the corpus.
    assert.equal(r.citations[0].id, ID_BOTH);
    assert.equal(r.citations[0].title, `EN ${ID_BOTH}`);
    assert.equal(r.citations[0].type, "shamail");
    assert.ok(r.citations[0].text.length > 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5.3 — never trust the model's self-reported citations.
// ─────────────────────────────────────────────────────────────────────────────
describe("citation validation discards the whole answer", () => {
  const discards = async (label: string, answer: ProviderOutcome, ids = [ID_BOTH]) => {
    const r = await ask(Q, { provider: twoStage(routed(ids), answer) });
    assert.equal(r.ok, true, `${label}: should be a graceful refusal, not an error`);
    if (!r.ok) return;
    assert.equal(r.mode, "out_of_corpus", `${label}: must fall through`);
    assert.deepEqual(r.citations, [], `${label}: no citations may survive`);
    assert.equal(r.answer, S.OUT_OF_CORPUS.en, `${label}: must use the fixed fallback copy`);
  };

  it("check 1 — a hallucinated id discards the answer", () =>
    discards("ghost id", answered("A confident but unsourced answer.", [ID_GHOST])));

  it("check 2 — an id that exists but has no body discards the answer", () =>
    discards("empty entry", answered("Plausible text.", [ID_EMPTY])));

  it("check 3 — an id whose body is only in the other language discards the answer", () =>
    discards("ur-only entry for an en answer", answered("Plausible text.", [ID_UR_ONLY])));

  it("zero citations discards the answer, however good it looks", () =>
    discards("no citations", answered("A beautifully written unsourced answer.", [])));

  it("citations not an array discards the answer", () =>
    discards("citations is a string", answered("text", ID_BOTH)));

  it("a non-string inside citations discards the answer", () =>
    discards("numeric id", answered("text", [ID_BOTH, 42])));

  it("ONE bad citation discards the whole answer — never partially rendered", () =>
    discards("one good one bad", answered("text", [ID_BOTH, ID_GHOST])));

  it("empty answer text discards it even when citations are valid", () =>
    discards("blank answer", answered("   ", [ID_BOTH])));

  it("mixed-language: an en-only entry cannot serve an Urdu answer", async () => {
    const r = await ask("حضور کا اخلاق کیسا تھا", {
      provider: twoStage(routed([ID_BOTH]), answered("جواب", [ID_EN_ONLY])),
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.language, "ur");
    assert.equal(r.mode, "out_of_corpus");
    assert.equal(r.answer, S.OUT_OF_CORPUS.ur, "the fallback must be localized too");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Provider failures on the answer stage.
// ─────────────────────────────────────────────────────────────────────────────
describe("answer-stage failures never become an unsourced answer", () => {
  // These report a SYSTEM failure rather than the out_of_corpus copy. That
  // copy claims the collection does not cover the question, which is false
  // here — the router found the material and generation failed. Saying so
  // would be a small lie in a system whose whole value is not overclaiming.
  it("truncated JSON mid-object (MAX_TOKENS) reports a system failure, not 'not in corpus'", async () => {
    const truncated = parseGeminiBody({
      candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"answer":"He was ge' }] } }],
    });
    const r = await ask(Q, { provider: twoStage(routed([ID_BOTH]), truncated) });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "provider_unavailable");
  });

  it("recitation block reports a system failure and never shows a partial", async () => {
    const blocked = parseGeminiBody({ candidates: [{ finishReason: "RECITATION" }] });
    const r = await ask(Q, { provider: twoStage(routed([ID_BOTH]), blocked) });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "provider_unavailable");
    assert.equal(r.message, S.SERVICE_ERROR.en);
  });

  it("429 surfaces as a typed failure, NOT as a refusal", async () => {
    const r = await ask(Q, {
      provider: twoStage(routed([ID_BOTH]), { ok: false, failure: "quota", detail: "429" }),
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "quota_exhausted");
    assert.equal(r.message, S.QUOTA_EXHAUSTED.en);
  });

  it("a provider that throws does not crash the pipeline", async () => {
    const r = await ask(Q, { provider: twoStage(routed([ID_BOTH]), new Error("boom")) });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "provider_unavailable");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The invariant the whole design rests on.
// ─────────────────────────────────────────────────────────────────────────────
describe("refusals never reach the answering model", () => {
  it("ruling_seeking short-circuits — answer() is never called", async () => {
    let answerCalled = false;
    const provider: LlmProvider = {
      id: "fake",
      classifyModel: "c",
      answerModel: "a",
      classify: () => Promise.resolve(routed([ID_BOTH])),
      answer: () => {
        answerCalled = true;
        return Promise.resolve(answered("SHOULD NEVER BE USED", [ID_BOTH]));
      },
    };
    // Ratchet fires on this one, before any model call at all.
    const r = await ask("Is it permissible to do this?", { provider });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.mode, "ruling_seeking");
    assert.equal(answerCalled, false, "the answering model must never see a ruling question");
    assert.equal(r.answer, S.RULING_SEEKING.en);
    assert.deepEqual(r.citations, []);
  });

  it("out_of_corpus short-circuits too", async () => {
    let answerCalled = false;
    const provider: LlmProvider = {
      id: "fake",
      classifyModel: "c",
      answerModel: "a",
      classify: () => Promise.resolve({ ok: true, data: { mode: "out_of_corpus", candidateIds: [] }, raw: {} }),
      answer: () => {
        answerCalled = true;
        return Promise.resolve(answered("x", [ID_BOTH]));
      },
    };
    const r = await ask(Q, { provider });
    assert.equal(answerCalled, false);
    assert.equal(r.ok && r.mode, "out_of_corpus");
  });

  it("the Urdu refusal copy is used for an Urdu ruling question", async () => {
    const r = await ask("کیا یہ جائز ہے؟", { provider: twoStage(routed([]), answered("x", [])) });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.mode, "ruling_seeking");
    assert.equal(r.answer, S.RULING_SEEKING.ur);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP contract (§5.4)
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/ask contract", () => {
  it("200 carries mode, language, answer, citations and the disclaimer", async () => {
    const res = await handleAsk(
      { question: Q, language: "en" },
      twoStage(routed([ID_BOTH]), answered("He was gentle.", [ID_BOTH]))
    );
    assert.equal(res.status, 200);
    const b = res.body as Record<string, unknown>;
    assert.equal(b.mode, "in_corpus");
    assert.equal(b.language, "en");
    assert.equal(b.answer, "He was gentle.");
    assert.equal((b.citations as unknown[]).length, 1);
    assert.equal(b.disclaimer, S.DISCLAIMER.en);
  });

  it("quota exhaustion is 503 with a typed code, not a fourth mode", async () => {
    const res = await handleAsk(
      { question: Q },
      twoStage(routed([ID_BOTH]), { ok: false, failure: "quota", detail: "429" })
    );
    assert.equal(res.status, 503);
    const err = (res.body as any).error;
    assert.equal(err.code, "quota_exhausted");
    assert.ok(err.retryAfterSeconds > 0);
    assert.equal((res.body as any).mode, undefined, "failures must not carry a mode");
  });

  it("a missing question is a 400", async () => {
    const res = await handleAsk({}, twoStage(routed([]), answered("x", [])));
    assert.equal(res.status, 400);
  });

  it("an over-long question is rejected before it becomes a prompt", async () => {
    const res = await handleAsk({ question: "x".repeat(2001) }, twoStage(routed([]), answered("x", [])));
    assert.equal(res.status, 400);
  });

  it("history is accepted and ignored", async () => {
    const res = await handleAsk(
      { question: Q, history: [{ role: "user", content: "earlier" }] },
      twoStage(routed([ID_BOTH]), answered("He was gentle.", [ID_BOTH]))
    );
    assert.equal(res.status, 200);
  });

  it("an Urdu question gets Urdu disclaimer and Urdu language field", async () => {
    const res = await handleAsk(
      { question: "کیا یہ جائز ہے؟" },
      twoStage(routed([]), answered("x", []))
    );
    const b = res.body as Record<string, unknown>;
    assert.equal(b.language, "ur");
    assert.equal(b.disclaimer, S.DISCLAIMER.ur);
    assert.equal(b.mode, "ruling_seeking");
  });
});

describe("fixed copy", () => {
  it("every user-facing string exists in both languages and is not a system message", () => {
    for (const [name, pair] of Object.entries({
      OUT_OF_CORPUS: S.OUT_OF_CORPUS,
      RULING_SEEKING: S.RULING_SEEKING,
      QUOTA_EXHAUSTED: S.QUOTA_EXHAUSTED,
      SERVICE_ERROR: S.SERVICE_ERROR,
      DISCLAIMER: S.DISCLAIMER,
    })) {
      assert.ok(pair.en.length > 20, `${name}.en too short`);
      assert.ok(pair.ur.length > 20, `${name}.ur too short`);
      assert.ok(/[؀-ۿ]/.test(pair.ur), `${name}.ur must actually be Urdu script`);
      assert.ok(!/\berror\b|\bnull\b|undefined|\bAI language model\b/i.test(pair.en), `${name}.en reads like a system message`);
    }
  });

  it("the ruling redirect actually points to a scholar", () => {
    assert.match(S.RULING_SEEKING.en, /scholar|alim/i);
    assert.match(S.RULING_SEEKING.ur, /عالم/);
  });
});

describe("system failure at the ROUTING stage is reported, not disguised", () => {
  // Found live: a 429 on the router made the pipeline emit "I could not find
  // anything in the collection", which is false — we were rate-limited. The
  // router still fails closed to out_of_corpus (correct); the user-facing text
  // must not pretend that was a considered answer.
  const routerFails = (failure: "quota" | "timeout" | "transport" | "http"): LlmProvider => ({
    id: "fake",
    classifyModel: "c",
    answerModel: "a",
    classify: () => Promise.resolve({ ok: false, failure, detail: "x" } as ProviderOutcome),
    answer: () => Promise.resolve(answered("never", [])),
  });

  it("router 429 becomes quota_exhausted, not a false 'not in corpus'", async () => {
    const r = await ask(Q, { provider: routerFails("quota") });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "quota_exhausted");
  });

  it("router timeout becomes provider_unavailable", async () => {
    const r = await ask(Q, { provider: routerFails("timeout") });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "provider_unavailable");
  });

  it("a GENUINE out_of_corpus still gets the honest fallback copy", async () => {
    const r = await ask(Q, {
      provider: twoStage({ ok: true, data: { mode: "out_of_corpus", candidateIds: [] }, raw: {} }, answered("x", [])),
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.mode, "out_of_corpus");
    assert.equal(r.answer, S.OUT_OF_CORPUS.en);
  });
});
