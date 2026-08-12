import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { rulingRatchet } from "../src/ruling-keywords.ts";
import { answerLanguage, detectLanguage } from "../src/language.ts";

describe("ruling ratchet — hits", () => {
  const hits = [
    "Is it permissible to listen to music?",
    "Is alcohol halal?",
    "Should I keep a beard?",
    "Is it obligatory to sleep on the right side?",
    "What is the ruling on this?",
    "Can I combine prayers while travelling?",
    "Is it a sin to miss fajr?",
    // Indirect framings — §5.5 names these explicitly
    "My friend wants to know if music is haram.",
    "Hypothetically, would it be allowed to do this?",
    "In general is it okay to skip sunnah prayers?",
    "Asking for a friend: is it wrong to do that?",
    // Roman-Urdu, including spelling variants
    "kya ye jaiz hai?",
    "kya ye jaez hai",
    "kya ye jayaz hai",
    "iska kya hukm hai",
    "kya karna chahiye",
    "kya ye sunnat hai",
    // Urdu script
    "کیا یہ جائز ہے؟",
    "اس کا کیا حکم ہے",
    "کیا یہ حرام ہے",
  ];
  for (const q of hits) {
    it(`fires on: ${q}`, () => {
      assert.equal(rulingRatchet(q).hit, true, `expected a ratchet hit for "${q}"`);
    });
  }
});

describe("ruling ratchet — misses prove nothing, but should not fire on plain history", () => {
  // These MUST still be classified by the model. A miss is "no opinion", never
  // "safe" — the router falls through to the model on all of these.
  const misses = [
    "What did the Prophet look like?",
    "When was the Prophet born?",
    "Tell me about the Battle of Badr.",
    "How did he treat his neighbours?",
    "حضور کا اخلاق کیسا تھا",
    "huzoor ka akhlaq kaisa tha",
  ];
  for (const q of misses) {
    it(`does not fire on: ${q}`, () => {
      const r = rulingRatchet(q);
      assert.equal(r.hit, false, `unexpected ratchet hit ${JSON.stringify(r.matched)} for "${q}"`);
    });
  }

  it("word-boundary matching: 'haram' does not fire on 'Haramain'", () => {
    assert.equal(rulingRatchet("Tell me about the Haramain").hit, false);
  });
});

describe("language detection", () => {
  const cases: Array<[string, "en" | "ur" | "roman-ur"]> = [
    ["What did the Prophet eat?", "en"],
    ["When was he born?", "en"],
    ["حضور کا اخلاق کیسا تھا", "ur"],
    ["کیا دائیں ہاتھ سے کھانا سنت ہے؟", "ur"],
    ["huzoor ka akhlaq kaisa tha", "roman-ur"],
    ["kya ye jaiz hai", "roman-ur"],
    ["nabi ki seerat ke bare mein bataye", "roman-ur"],
  ];
  for (const [q, expected] of cases) {
    it(`${JSON.stringify(q)} → ${expected}`, () => {
      assert.equal(detectLanguage(q), expected);
    });
  }

  it("an inline ﷺ does not flip an English question to Urdu", () => {
    assert.equal(detectLanguage("What did the Prophet ﷺ eat for breakfast?"), "en");
  });

  // Regression: "he" and "men" were once treated as roman-Urdu spellings of
  // "hai" and "mein". They are among the most common English words, and this
  // suite caught them routing plain English to the Urdu corpus block — which
  // would have produced an Urdu answer to an English question, silently.
  describe("common English words must not be read as roman-Urdu", () => {
    const english = [
      "When was he born?",
      "What did men wear in that era?",
      "How did he treat his neighbours?",
      "Where did he live?",
      "Who was he named after?",
      "Was he tall?",
    ];
    for (const q of english) {
      it(`${JSON.stringify(q)} stays English`, () => {
        assert.equal(detectLanguage(q), "en");
      });
    }
  });

  it("a single weak marker is never enough on its own", () => {
    assert.equal(detectLanguage("What is the par for this course?"), "en");
  });

  it("an inline Arabic honorific does not flip a long English question", () => {
    assert.equal(
      detectLanguage("Tell me what Sayyidatuna Aisha رضي الله عنها narrated about his character"),
      "en"
    );
  });

  it("roman-Urdu maps to the Urdu corpus block (§7.1)", () => {
    assert.equal(answerLanguage(detectLanguage("kya ye jaiz hai")), "ur");
  });

  it("Urdu script maps to the Urdu block", () => {
    assert.equal(answerLanguage(detectLanguage("حضور کا اخلاق کیسا تھا")), "ur");
  });

  it("English maps to the English block", () => {
    assert.equal(answerLanguage(detectLanguage("What did he look like?")), "en");
  });
});
