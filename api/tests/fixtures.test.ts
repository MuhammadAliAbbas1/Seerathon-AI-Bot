import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { MissingFixtureError, fixtureKey } from "../src/providers/fixtures.ts";
import { PROMPT_VERSION, SCHEMA_VERSION } from "../src/prompts.ts";

const base = {
  op: "classify" as const,
  provider: "gemini",
  model: "gemini-2.5-flash-lite",
  question: "What did the Prophet eat?",
  language: "en",
};

describe("fixture keys", () => {
  it("are stable for identical input", () => {
    assert.equal(fixtureKey(base), fixtureKey({ ...base }));
  });

  it("normalise whitespace and Unicode so trivially different questions share a fixture", () => {
    assert.equal(
      fixtureKey(base),
      fixtureKey({ ...base, question: "  What did the   Prophet eat?  " })
    );
  });

  it("differ by question", () => {
    assert.notEqual(fixtureKey(base), fixtureKey({ ...base, question: "Something else" }));
  });

  it("differ by language — the same words in a different block are a different call", () => {
    assert.notEqual(fixtureKey(base), fixtureKey({ ...base, language: "ur" }));
  });

  it("differ by model", () => {
    assert.notEqual(fixtureKey(base), fixtureKey({ ...base, model: "gemini-2.5-flash" }));
  });

  it("differ by provider — Gemini and OpenRouter fixtures must never collide", () => {
    assert.notEqual(fixtureKey(base), fixtureKey({ ...base, provider: "openrouter" }));
  });

  it("differ by operation", () => {
    assert.notEqual(fixtureKey(base), fixtureKey({ ...base, op: "answer" as const }));
  });
});

describe("prompt versioning", () => {
  // The guard that makes invalidation automatic: PROMPT_VERSION is IN the key,
  // so editing a prompt turns every affected fixture into a loud miss rather
  // than silently replaying the old prompt's behaviour (§5.6).
  it("PROMPT_VERSION and SCHEMA_VERSION are non-empty", () => {
    assert.ok(PROMPT_VERSION.length > 0);
    assert.ok(SCHEMA_VERSION.length > 0);
  });

  it("a missing fixture is a loud, actionable failure — never a silent live call", () => {
    const err = new MissingFixtureError("deadbeef", "some question");
    assert.match(err.message, /FIXTURES=record/);
    assert.match(err.message, /never fall through to a live call/);
    assert.equal(err.name, "MissingFixtureError");
  });
});

describe("key encoding is unambiguous", () => {
  // Regression: the key was once built by joining fields on a separator. A
  // free-text question can contain any separator we pick, which would let two
  // different field splits collide. JSON encoding removes the ambiguity.
  it("adjacent field boundaries cannot be confused", () => {
    const a = fixtureKey({ ...base, provider: "ab", model: "c" });
    const b = fixtureKey({ ...base, provider: "a", model: "bc" });
    assert.notEqual(a, b);
  });

  it("a question containing quotes or separators still keys cleanly", () => {
    const k = fixtureKey({ ...base, question: 'he said "is it | halal?" then left' });
    assert.match(k, /^[0-9a-f]{32}$/);
  });
});
