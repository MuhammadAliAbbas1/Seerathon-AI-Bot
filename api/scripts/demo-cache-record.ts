/**
 * Records the fixtures the demo cache needs. **THIS COSTS QUOTA.**
 *
 * Separate from `demo-cache-build.ts` on purpose: the build step must never be
 * able to reach the network, because a build that silently dials out is how a
 * "free" run quietly spends a day's budget (§5.6).
 *
 *   node api/scripts/demo-cache-record.ts --dry    what it WOULD spend, free
 *   node api/scripts/demo-cache-record.ts          record the gaps, live
 *
 * Only gaps are recorded. Anything already in `api/fixtures/` — and most of
 * this set is, paid for by the adversarial suite — costs nothing.
 *
 * Paced per §5.6, because a loop will trip the burst limit and a human will not.
 */
import { pace } from "../src/pace.ts";
import { createGeminiProvider } from "../src/providers/gemini.ts";
import { withFixtures, fixtureKey, readFixture } from "../src/providers/fixtures.ts";
import { ask } from "../src/ask.ts";
import { detectLanguage, answerLanguage } from "../src/language.ts";
import { CACHEABLE } from "../src/demo-questions.ts";

const dry = process.argv.includes("--dry");
const base = createGeminiProvider();

/** What each question still needs. `answer` is only knowable after routing. */
function classifyCached(question: string, language: string): boolean {
  return !!readFixture(
    fixtureKey({ op: "classify", provider: base.id, model: base.classifyModel, question, language })
  );
}
function answerCached(question: string, language: string): boolean {
  return !!readFixture(
    fixtureKey({ op: "answer", provider: base.id, model: base.answerModel, question, language })
  );
}

console.log(`Demo-cache recording — ${dry ? "DRY RUN (no network)" : "LIVE (spends quota)"}\n`);

const plan = CACHEABLE.map((q) => {
  const language = answerLanguage(detectLanguage(q.question));
  return {
    ...q,
    language,
    needClassify: !classifyCached(q.question, language),
    // An out_of_corpus question never reaches the answer model, so a missing
    // answer fixture is not necessarily a gap. Reported as "maybe" until the
    // route is known.
    answerCached: answerCached(q.question, language),
  };
});

for (const p of plan) {
  const bits = [
    p.needClassify ? "classify NEEDED" : "classify cached",
    p.answerCached ? "answer cached" : "answer maybe-needed (depends on route)",
  ];
  console.log(`  ${p.label.padEnd(24)} lang=${p.language}  ${bits.join("  ·  ")}`);
}

const worstCase = plan.filter((p) => p.needClassify).length + plan.filter((p) => !p.answerCached).length;
console.log(`\nWorst-case live requests: ${worstCase}`);
console.log(`  (upper bound — an out_of_corpus route makes its answer call unnecessary)\n`);

if (dry) {
  console.log("Dry run. Nothing spent, nothing written.");
  process.exit(0);
}

const todo = plan.filter((p) => p.needClassify || !p.answerCached);
if (todo.length === 0) {
  console.log("Nothing to record — every fixture already exists.");
  process.exit(0);
}

const provider = withFixtures(base, "record");
let first = true;
let spent = 0;

for (const p of todo) {
  if (!first) await pace(base.answerModel, p.label);
  first = false;

  const t0 = Date.now();
  const before = { c: classifyCached(p.question, p.language), a: answerCached(p.question, p.language) };
  const r = await ask(p.question, { provider });
  const after = { c: classifyCached(p.question, p.language), a: answerCached(p.question, p.language) };

  const recorded = [!before.c && after.c ? "classify" : null, !before.a && after.a ? "answer" : null].filter(Boolean);
  spent += recorded.length;

  const mode = r.ok ? `${r.mode} (${r.reason})` : `FAILED ${r.code}`;
  console.log(
    `  ${p.label.padEnd(24)} ${mode.padEnd(34)} ${Date.now() - t0}ms  recorded=[${recorded.join(", ") || "nothing"}]`
  );

  // A failure here is a property of the moment, and the fixture allowlist has
  // already refused to record it. Say so rather than leaving a silent gap that
  // the build step will later report as missing with no explanation.
  if (!r.ok) console.log(`      ↑ not recorded (transient by definition). Re-run when it clears.`);
}

console.log(`\n${spent} fixture(s) written. Now run: node api/scripts/demo-cache-build.ts`);
