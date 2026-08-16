/**
 * Builds `demo-cache.json` from ALREADY-RECORDED fixtures (CLAUDE.md §5.6).
 *
 * ⚠️ This script spends NO quota and cannot. It only copies recorded provider
 * envelopes out of `api/fixtures/`. If a curated question has no fixture, it
 * says so and exits non-zero — recording is a separate, deliberate act:
 *
 *     node api/scripts/record-answers.ts <case ids>     ← costs quota
 *     node api/scripts/demo-cache-build.ts              ← free, run after
 *
 * Keeping those apart is the point. A build step that silently reaches for the
 * network is how a "free" run quietly spends a day's budget — the same lesson
 * the fixture layer already learned the hard way (§5.6, the F8 story).
 *
 * ── What is curated, and why it stops where it does ────────────────────────
 *
 * The landing screen's example chips, and nothing else by default.
 *
 * Chips send the question in the SHELL language, so flipping the UR/EN toggle
 * changes what they send: the four visible chips are six distinct questions.
 * Two of those six trip the ruling ratchet, which already costs zero requests
 * and returns instantly (§5.5) — caching them would add entries that do
 * nothing, so they are deliberately absent.
 *
 * The two typed questions are the most likely thing a judge asks a Shamail bot
 * unprompted. They are here because a judge typing their own first question is
 * the moment a 503 does the most damage.
 */
import { writeFileSync } from "node:fs";
import { createGeminiProvider } from "../src/providers/gemini.ts";
import { fixtureKey, readFixture } from "../src/providers/fixtures.ts";
import { detectLanguage, answerLanguage } from "../src/language.ts";
import { rulingRatchet } from "../src/ruling-keywords.ts";
import { route } from "../src/router.ts";
import { DEMO_CACHE_PATH, expectedGate, gateFingerprint } from "../src/demo-cache.ts";
import { CACHEABLE } from "../src/demo-questions.ts";
import type { DemoCacheFile } from "../src/demo-cache.ts";
import type { ProviderOutcome } from "../src/providers/types.ts";

const CURATED = CACHEABLE;

const provider = createGeminiProvider();
const entries: Record<string, ProviderOutcome> = {};
const index: DemoCacheFile["questions"] = [];
const missing: string[] = [];

console.log("Building demo-cache.json from recorded fixtures (no network).\n");

for (const c of CURATED) {
  const language = answerLanguage(detectLanguage(c.question));
  const ratchet = rulingRatchet(c.question);

  if (ratchet.hit) {
    console.log(`  ${c.label}\n    SKIPPED — ratchet hits [${ratchet.matched.join(", ")}], costs 0 requests already`);
    continue;
  }

  // Which ops this question actually needs is a property of how it routes: an
  // out_of_corpus question never reaches the answer model, so requiring an
  // answer fixture for it would report a permanent, unfixable gap.
  const routed = await route(c.question, { provider: wrapReadOnly() });
  const ops: Array<"classify" | "answer"> = routed.mode === "in_corpus" ? ["classify", "answer"] : ["classify"];

  const got: string[] = [];
  for (const op of ops) {
    const model = op === "classify" ? provider.classifyModel : provider.answerModel;
    const key = fixtureKey({ op, provider: provider.id, model, question: c.question, language });
    const outcome = readFixture(key);
    if (!outcome || !outcome.ok) {
      missing.push(`${c.label} [${op}] — key ${key}`);
      continue;
    }
    entries[key] = outcome;
    got.push(op);
  }

  index.push({ label: c.label, question: c.question, language, ops: got });
  console.log(`  ${c.label}\n    lang=${language} mode=${routed.mode} ops=[${got.join(", ")}]`);
}

if (missing.length) {
  console.error(`\n✗ ${missing.length} fixture(s) missing. Nothing written.\n`);
  for (const m of missing) console.error(`    ${m}`);
  console.error(`\nRecord them deliberately (this COSTS quota), then re-run:`);
  console.error(`    FIXTURES=record  +  a runner that asks exactly these questions\n`);
  process.exit(1);
}

const gate = expectedGate(provider);
const file: DemoCacheFile = {
  gate,
  builtAt: new Date().toISOString(),
  questions: index,
  entries,
};

writeFileSync(DEMO_CACHE_PATH, JSON.stringify(file, null, 2) + "\n", "utf8");

console.log(`\n✔ demo-cache.json — ${index.length} questions, ${Object.keys(entries).length} recorded responses`);
console.log(`  gate ${gateFingerprint(gate)}  corpus ${gate.corpusVersion}  ${gate.classifyModel} / ${gate.answerModel}`);
console.log(`  prompts ${gate.classifyPromptVersion} / ${gate.answerPromptVersion}`);

/**
 * A provider that can only ever REPLAY. `route()` needs one to decide whether
 * a question reaches the answer model, and this build must not be able to spend
 * quota even by accident — so a miss here throws rather than dialling out.
 */
function wrapReadOnly() {
  return {
    id: provider.id,
    classifyModel: provider.classifyModel,
    answerModel: provider.answerModel,
    async classify(req: { question: string; language: string }): Promise<ProviderOutcome> {
      const key = fixtureKey({
        op: "classify", provider: provider.id, model: provider.classifyModel,
        question: req.question, language: req.language,
      });
      const hit = readFixture(key);
      if (hit) return hit;
      return { ok: false, failure: "transport", detail: "demo-cache-build: no fixture, refusing to go live" };
    },
    async answer(): Promise<ProviderOutcome> {
      return { ok: false, failure: "transport", detail: "demo-cache-build never calls the answer model" };
    },
  } as ReturnType<typeof createGeminiProvider>;
}
