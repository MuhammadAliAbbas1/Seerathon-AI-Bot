import { strict as assert } from "node:assert";
import { before, describe, it } from "node:test";
import { route } from "../src/router.ts";
import { parseGeminiBody } from "../src/providers/gemini.ts";
import {
  FAKE_INDEX,
  ID_BOTH,
  ID_EMPTY,
  ID_EN_ONLY,
  ID_GHOST,
  ID_UR_ONLY,
  fakeProvider,
  installFakeCorpus,
  respondsWith,
} from "./helpers.ts";

before(() => installFakeCorpus());

const run = (question: string, provider: ReturnType<typeof respondsWith>) =>
  route(question, { provider, index: FAKE_INDEX });

// A question with no ruling keywords, so the ratchet does not short-circuit
// and the model's response is actually exercised.
const NEUTRAL = "What did the Prophet do when he was angry?";

describe("happy paths", () => {
  it("in_corpus with a citable id", async () => {
    const r = await run(NEUTRAL, respondsWith({ mode: "in_corpus", candidateIds: [ID_BOTH] }));
    assert.equal(r.mode, "in_corpus");
    assert.deepEqual(r.candidateIds, [ID_BOTH]);
    assert.equal(r.reason, "model");
  });

  it("out_of_corpus carries no candidates even if the model supplied some", async () => {
    const r = await run(NEUTRAL, respondsWith({ mode: "out_of_corpus", candidateIds: [ID_BOTH] }));
    assert.equal(r.mode, "out_of_corpus");
    assert.deepEqual(r.candidateIds, [], "a non-empty citations array on a refusal mode is a bug (§5.4)");
  });

  it("ruling_seeking carries no candidates even if the model supplied some", async () => {
    const r = await run(NEUTRAL, respondsWith({ mode: "ruling_seeking", candidateIds: [ID_BOTH] }));
    assert.equal(r.mode, "ruling_seeking");
    assert.deepEqual(r.candidateIds, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fail-closed. This is THE guarantee, not a backup — responseSchema's enum is
// explicitly not strictly enforced (§5.2). Every case must land on
// out_of_corpus AND must not throw.
// ─────────────────────────────────────────────────────────────────────────────
describe("fail-closed", () => {
  const mustFallBack = async (label: string, provider: ReturnType<typeof respondsWith>, reason?: string) => {
    const r = await run(NEUTRAL, provider);
    assert.equal(r.mode, "out_of_corpus", `${label} must land on out_of_corpus`);
    assert.deepEqual(r.candidateIds, [], `${label} must carry no candidates`);
    if (reason) assert.equal(r.reason, reason);
  };

  it("off-enum mode (wrong case)", () =>
    mustFallBack("IN_CORPUS", respondsWith({ mode: "IN_CORPUS", candidateIds: [ID_BOTH] }), "model-off-enum"));

  it("off-enum mode (invented value)", () =>
    mustFallBack("answer", respondsWith({ mode: "answer", candidateIds: [ID_BOTH] }), "model-off-enum"));

  it("mode field missing entirely", () =>
    mustFallBack("no mode", respondsWith({ candidateIds: [ID_BOTH] }), "model-off-enum"));

  it("mode is not a string", () =>
    mustFallBack("numeric mode", respondsWith({ mode: 1, candidateIds: [] }), "model-off-enum"));

  it("data is an array, not an object", () =>
    mustFallBack("array", respondsWith([{ mode: "in_corpus" }]), "model-malformed"));

  it("data is null", () => mustFallBack("null", respondsWith(null), "model-malformed"));

  it("malformed JSON from the provider", () =>
    mustFallBack(
      "unparseable",
      fakeProvider({ ok: false, failure: "malformed", detail: "unparseable JSON" }),
      "model-malformed"
    ));

  it("truncated JSON mid-object (the MAX_TOKENS case)", () => {
    // Exactly what Gemini returns when thinking eats the output budget.
    const truncated = parseGeminiBody({
      candidates: [
        {
          finishReason: "MAX_TOKENS",
          content: { parts: [{ text: '{"mode":"in_corpus","candidateIds":["aaaa' }] },
        },
      ],
    });
    assert.equal(truncated.ok, false);
    return mustFallBack("truncated", fakeProvider(truncated), "model-malformed");
  });

  it("empty candidates array (blocked content is not returned)", () => {
    const empty = parseGeminiBody({ candidates: [] });
    assert.equal(empty.ok, false);
    return mustFallBack("empty candidates", fakeProvider(empty), "model-empty");
  });

  it("safety block via finishReason", () => {
    const blocked = parseGeminiBody({
      candidates: [{ finishReason: "SAFETY", safetyRatings: [{ category: "HARM_CATEGORY_HARASSMENT" }] }],
    });
    assert.equal(blocked.ok, false);
    return mustFallBack("SAFETY", fakeProvider(blocked), "model-blocked");
  });

  it("recitation block — the live risk for a corpus-reproducing bot (§5.4)", () => {
    const blocked = parseGeminiBody({ candidates: [{ finishReason: "RECITATION" }] });
    assert.equal(blocked.ok, false);
    return mustFallBack("RECITATION", fakeProvider(blocked), "model-blocked");
  });

  it("prompt blocked before generation (promptFeedback.blockReason)", () => {
    const blocked = parseGeminiBody({ promptFeedback: { blockReason: "SAFETY" } });
    assert.equal(blocked.ok, false);
    return mustFallBack("promptFeedback", fakeProvider(blocked), "model-blocked");
  });

  it("429 quota exhaustion never becomes an answer", () =>
    mustFallBack("429", fakeProvider({ ok: false, failure: "quota", detail: "429" }), "provider-quota"));

  it("timeout", () =>
    mustFallBack("timeout", fakeProvider({ ok: false, failure: "timeout", detail: "abort" }), "provider-timeout"));

  it("transport failure", () =>
    mustFallBack("transport", fakeProvider({ ok: false, failure: "transport", detail: "ECONNRESET" }), "provider-transport"));

  it("a provider that throws despite the contract does not crash the router", async () => {
    const throwing = fakeProvider(() => Promise.reject(new Error("boom")) as Promise<never>);
    const r = await run(NEUTRAL, throwing);
    assert.equal(r.mode, "out_of_corpus");
  });

  it("blank question never reaches the model", async () => {
    const r = await run("   ", respondsWith({ mode: "in_corpus", candidateIds: [ID_BOTH] }));
    assert.equal(r.mode, "out_of_corpus");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5.3 — citation validation applied to candidates.
// ─────────────────────────────────────────────────────────────────────────────
describe("candidate validation (§5.3)", () => {
  it("check 1 — a hallucinated id is dropped and in_corpus collapses", async () => {
    const r = await run(NEUTRAL, respondsWith({ mode: "in_corpus", candidateIds: [ID_GHOST] }));
    assert.equal(r.mode, "out_of_corpus");
    assert.equal(r.reason, "no-valid-candidates");
  });

  it("check 2 — an entry that exists but has no body is dropped", async () => {
    const r = await run(NEUTRAL, respondsWith({ mode: "in_corpus", candidateIds: [ID_EMPTY] }));
    assert.equal(r.mode, "out_of_corpus", "existence is not content");
  });

  it("check 3 — an English-only entry cannot serve an Urdu answer", async () => {
    const r = await route("حضور کا اخلاق کیسا تھا", {
      provider: respondsWith({ mode: "in_corpus", candidateIds: [ID_EN_ONLY] }),
      index: FAKE_INDEX,
    });
    assert.equal(r.language, "ur");
    assert.equal(r.mode, "out_of_corpus", "citing text the user cannot read is not an answer");
  });

  it("check 3 — an Urdu-only entry cannot serve an English answer", async () => {
    const r = await run(NEUTRAL, respondsWith({ mode: "in_corpus", candidateIds: [ID_UR_ONLY] }));
    assert.equal(r.mode, "out_of_corpus");
  });

  it("mixed valid and invalid ids keeps only the valid ones", async () => {
    const r = await run(
      NEUTRAL,
      respondsWith({ mode: "in_corpus", candidateIds: [ID_GHOST, ID_BOTH, ID_EMPTY, ID_EN_ONLY] })
    );
    assert.equal(r.mode, "in_corpus");
    assert.deepEqual(r.candidateIds, [ID_BOTH, ID_EN_ONLY]);
  });

  it("duplicate ids are collapsed", async () => {
    const r = await run(NEUTRAL, respondsWith({ mode: "in_corpus", candidateIds: [ID_BOTH, ID_BOTH] }));
    assert.deepEqual(r.candidateIds, [ID_BOTH]);
  });

  it("non-string ids are ignored rather than crashing", async () => {
    const r = await run(NEUTRAL, respondsWith({ mode: "in_corpus", candidateIds: [null, 42, {}, ID_BOTH] }));
    assert.deepEqual(r.candidateIds, [ID_BOTH]);
  });

  it("candidateIds missing entirely collapses to fallback", async () => {
    const r = await run(NEUTRAL, respondsWith({ mode: "in_corpus" }));
    assert.equal(r.mode, "out_of_corpus");
  });

  it("candidate list is capped at 5", async () => {
    const many = Array(12).fill(ID_BOTH).map((id, i) => (i === 0 ? id : ID_BOTH));
    const r = await run(NEUTRAL, respondsWith({ mode: "in_corpus", candidateIds: many }));
    assert.ok(r.candidateIds.length <= 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Precedence — the single most important behaviour in the router.
// ─────────────────────────────────────────────────────────────────────────────
describe("precedence: ruling_seeking beats in_corpus", () => {
  it("TEST #1 — 'Is it sunnah to eat with the right hand?' refuses even though the model said in_corpus", async () => {
    // The model is deliberately made to answer in_corpus with a perfectly
    // valid, citable id. The corpus DOES cover how he ﷺ ate. Answering would
    // produce a fatwa that is worse for looking well-cited.
    const r = await run(
      "Is it sunnah to eat with the right hand?",
      respondsWith({ mode: "in_corpus", candidateIds: [ID_BOTH] })
    );
    assert.equal(r.mode, "ruling_seeking");
    assert.equal(r.reason, "keyword-ratchet");
    assert.deepEqual(r.candidateIds, []);
  });

  it("Urdu equivalent", async () => {
    const r = await route("کیا دائیں ہاتھ سے کھانا سنت ہے؟", {
      provider: respondsWith({ mode: "in_corpus", candidateIds: [ID_BOTH] }),
      index: FAKE_INDEX,
    });
    assert.equal(r.mode, "ruling_seeking");
    assert.equal(r.language, "ur");
  });

  it("roman-Urdu equivalent", async () => {
    const r = await run(
      "kya dayen haath se khana sunnat hai?",
      respondsWith({ mode: "in_corpus", candidateIds: [ID_BOTH] })
    );
    assert.equal(r.mode, "ruling_seeking");
  });

  it("a model saying ruling_seeking is never overridden toward answering", async () => {
    const r = await run(NEUTRAL, respondsWith({ mode: "ruling_seeking", candidateIds: [ID_BOTH] }));
    assert.equal(r.mode, "ruling_seeking");
  });
});
