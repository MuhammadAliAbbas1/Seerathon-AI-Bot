/**
 * Phase 3 live batch. COSTS QUOTA.
 *
 * Ordered most-valuable-first, because gemini-2.5-flash-lite is close to its
 * daily cap: Group 1 (recitation) is the least-tested load-bearing claim in the
 * design, so it runs before anything that could exhaust the router model.
 *
 * Runs to completion. Nothing is fixed between cases.
 */
import { pace } from "../src/pace.ts";
import { createGeminiProvider } from "../src/providers/gemini.ts";
import { withFixtures } from "../src/providers/fixtures.ts";
import { ask } from "../src/ask.ts";
import { getEntry, loadCorpus } from "../src/corpus.ts";
import { entryTextForCitation, entryTitle } from "../src/entry-text.ts";
import { fixtureKey, readFixture } from "../src/providers/fixtures.ts";
import { detectLanguage, answerLanguage } from "../src/language.ts";
import { GEMINI_CLASSIFY_MODEL } from "../src/providers/gemini.ts";
import * as S from "../src/strings.ts";
import { EXECUTABLE } from "../../tests/cases.ts";

const provider = withFixtures(createGeminiProvider(), "record");

/**
 * Cases come from tests/cases.ts — the single source of truth that
 * tests/adversarial.md is also generated from.
 *
 * They used to be typed out here as well. The two lists drifted: the
 * retry-attack cases were run as G1-G4 while documented as I1-I4, colliding
 * with a group G that already existed; B1's wording differed between the two;
 * and eight documented cases appeared in no runner at all. A hand-typed
 * duplicate of a list that also lives in a document is a drift generator.
 */
type Case = { id: string; q: string; why: string };

const CASES: Case[] = EXECUTABLE.map((c) => ({
  id: c.id,
  q: c.question as string,
  why: c.expected.replace(/[`*]/g, ""),
}));

/** Word n-gram overlap — the test for "substantially reproduces". */
function longestSharedRun(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().normalize("NFC").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const A = norm(a);
  const bw = norm(b);
  // longest run of consecutive answer words that all appear in the source,
  // in order, as a contiguous source substring
  const bJoined = " " + bw.join(" ") + " ";
  let best = 0;
  for (let i = 0; i < A.length; i++) {
    for (let j = i + best + 1; j <= A.length; j++) {
      const run = " " + A.slice(i, j).join(" ") + " ";
      if (bJoined.includes(run)) best = Math.max(best, j - i);
      else break;
    }
  }
  return best;
}

const routerCached = (q: string) => {
  const detected = detectLanguage(q);
  const lang = answerLanguage(detected);
  return !!readFixture(fixtureKey({ op: "classify", provider: "gemini", model: GEMINI_CLASSIFY_MODEL, question: q, language: lang }));
};

/**
 * Optional subset:  node api/scripts/record-answers.ts H5,R1,H6
 *
 * The deferred cases are re-run alone rather than replaying the whole batch —
 * replaying would spend nothing on the cached cases but would still walk the
 * paced loop, and more importantly it makes "what did this run actually cost?"
 * ambiguous. One run, one intent.
 */
function selection(): Case[] {
  const only = (process.argv[2] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return only.length ? CASES.filter((c) => only.includes(c.id)) : CASES;
}

console.log(`corpus ${loadCorpus().corpusVersion}\n`);
console.log("router fixture already recorded?");
for (const c of selection()) console.log(`  ${c.id.padEnd(4)} ${routerCached(c.q) ? "cached (no router request)" : "NEW router request needed"}`);
console.log();

const results: any[] = [];

// Run a subset:  node api/scripts/record-answers.ts H5,R1,H6,F8,F9,F6b
// The deferred cases are re-run alone rather than replaying the whole batch,
// which would spend quota re-recording nothing.
const SELECTED = selection();

let first = true;
for (const c of SELECTED) {
  // Pace on the ANSWER model, the tighter of the two limits.
  if (!first) await pace("gemini-2.5-flash", c.id);
  first = false;
  const t0 = Date.now();
  let r: any, err: string | null = null;
  try {
    r = await ask(c.q, { provider });
  } catch (e) {
    err = (e as Error).message.split("\n")[0] ?? "unknown error";
    r = null;
  }
  const ms = Date.now() - t0;

  const row: any = { ...c, ms, err };
  if (r && r.ok) {
    row.mode = r.mode;
    row.language = r.language;
    row.answer = r.answer;
    row.citations = r.citations;
    row.reason = r.reason;
    // Re-verify §5.3 independently of the pipeline: prove each id passes all
    // three checks, and that the card text is byte-identical to the cache.
    const lang = r.language as "en" | "ur";
    row.checks = (r.citations || []).map((cit: any) => {
      const e = getEntry(cit.id);
      return {
        id: cit.id,
        check1_exists: !!e,
        check2_hasBody: !!e && (e.hasBody.en || e.hasBody.ur),
        check3_bodyInAnswerLang: !!e && e.hasBody[lang] === true,
        titleFromCache: !!e && cit.title === entryTitle(e, lang),
        textFromCache: !!e && cit.text === entryTextForCitation(e, lang),
      };
    });
    row.maxSharedRun = (r.citations || []).reduce(
      (m: number, cit: any) => Math.max(m, longestSharedRun(r.answer, cit.text)), 0);
  } else if (r && !r.ok) {
    row.mode = "(failure)";
    row.failCode = r.code;
  }
  results.push(row);
  process.stdout.write(`  ${c.id} ${row.mode ?? "ERR"} (${ms} ms)${err ? " — " + err : ""}\n`);
}

console.log("\n" + "=".repeat(78));
for (const r of results) {
  console.log(`\n─── ${r.id} ${"─".repeat(56)}`);
  console.log(`Q: ${r.q}`);
  console.log(`   why: ${r.why}`);
  if (r.err) { console.log(`   ERROR: ${r.err}`); continue; }
  console.log(`   mode      : ${r.mode}${r.failCode ? " code=" + r.failCode : ""}`);
  if (r.language) console.log(`   language  : ${r.language}   reason: ${r.reason}`);
  if (r.citations) {
    console.log(`   citations : ${r.citations.length ? r.citations.map((c: any) => c.id).join(", ") : "(none)"}`);
    for (const ck of r.checks ?? []) {
      const all = ck.check1_exists && ck.check2_hasBody && ck.check3_bodyInAnswerLang && ck.titleFromCache && ck.textFromCache;
      console.log(`     ${all ? "✔" : "✗"} ${ck.id}  exists=${ck.check1_exists} hasBody=${ck.check2_hasBody} inAnswerLang=${ck.check3_bodyInAnswerLang} titleFromCache=${ck.titleFromCache} textFromCache=${ck.textFromCache}`);
    }
    // Reported for EVERY cited answer, not just the recitation group. The
    // §5.4 rule applies to all of them, and the one case that crept up to 7
    // words was an ordinary quality question, not a recitation trap.
    if (r.citations.length) {
      console.log(`   longest verbatim run shared with source: ${r.maxSharedRun} words ${r.maxSharedRun >= 8 ? "← SUBSTANTIAL REPRODUCTION" : "(paraphrased)"}`);
    }
  }
  if (r.answer) {
    console.log(`   ── answer ──\n${r.answer.split("\n").map((l: string) => "   " + l).join("\n")}`);
  }
}

console.log("\n" + "=".repeat(78));
console.log("H5 date rendering check:");
const h5 = getEntry("671e4de2a99825600fd28d29");
console.log(`  gregorianDate raw   : ${h5?.gregorianDate}`);
console.log(`  gregorianDateLabel  : ${h5?.gregorianDateLabel}`);
console.log(`  umarMubarakLabel    : ${h5?.umarMubarakLabel}`);

console.log("\nFIXED LOCALIZED STRINGS — review the Urdu register:");
for (const [name, pair] of Object.entries({
  "out_of_corpus fallback": S.OUT_OF_CORPUS,
  "ruling_seeking / alim":  S.RULING_SEEKING,
  "quota exhausted":        S.QUOTA_EXHAUSTED,
  "service error":          S.SERVICE_ERROR,
  "persistent disclaimer":  S.DISCLAIMER,
})) {
  console.log(`\n  ${name}`);
  console.log(`    en: ${pair.en}`);
  console.log(`    ur: ${pair.ur}`);
}
