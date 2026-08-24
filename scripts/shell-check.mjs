/**
 * Invariants inside `mobile/` that NOTHING ELSE CAN REACH.
 *
 * The API tsconfig excludes `mobile`, and the test runner's glob is
 * `api/tests/*.test.ts`. So the app's own claims and rendering rules are
 * checked by neither. The obvious fix — importing a mobile module from a test —
 * was tried and reverted: `module: nodenext` resolves module kind from the
 * nearest package.json, and `mobile/package.json` has no `"type": "module"`, so
 * tsc reports every export in theme.ts as an illegal CommonJS export. Adding
 * `"type": "module"` there to satisfy a test would change how Metro resolves
 * the app — a real risk taken for a test's convenience.
 *
 * So these are checked from outside, by reading the files as text. That is also
 * why both live in one script: they are here for the same reason, not because
 * they are the same kind of check.
 *
 *   node scripts/shell-check.mjs           report
 *   node scripts/shell-check.mjs --check   exit 1 on drift
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const failures = [];

const corpus = JSON.parse(readFileSync(join(root, "corpus.json"), "utf8"));
const strings = readFileSync(join(root, "mobile", "src", "strings.ts"), "utf8");
const theme = readFileSync(join(root, "mobile", "src", "theme.ts"), "utf8");

/* ── 1. The corpus count the landing screen states ──────────────────────────
 *
 * That number is load-bearing copy. "Approved collection" is vague and reads as
 * marketing; a concrete checkable figure supplies the REASON refusal exists —
 * the collection is small and fixed, so a bounded bot is the correct bot rather
 * than a weak one.
 *
 * A stale number is not cosmetic. It is the app stating something false about
 * its own corpus, on the one screen whose entire job is establishing that this
 * bot only says what it can stand behind (§2).
 *
 * This VERIFIES rather than generates: the number sits mid-sentence in English
 * and in Urdu-Indic digits, and generating into prose is how you get a mangled
 * sentence in a language you cannot read.
 */
const toUrduDigits = (n) => String(n).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
const total = corpus.counts.total;
const wantEn = String(total);
const wantUr = toUrduDigits(total);

/** Scoped to emptyBody: a bare file-wide `includes("154")` would pass on any
 *  unrelated 154 anywhere in the shell — green, and proving nothing (§5.6). */
function emptyBody(langKey) {
  const block = strings.match(/emptyBody:\s*\{([\s\S]*?)\n\s{2}\}/);
  if (!block) return null;
  const line = block[1].match(new RegExp(`${langKey}:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  return line ? line[1] : null;
}

const en = emptyBody("en");
const ur = emptyBody("ur");

if (en === null) failures.push("could not find emptyBody.en in mobile/src/strings.ts");
if (ur === null) failures.push("could not find emptyBody.ur in mobile/src/strings.ts");
if (en !== null && !en.includes(wantEn)) failures.push(`emptyBody.en does not state ${wantEn} (corpus.json counts.total)`);
if (ur !== null && !ur.includes(wantUr)) failures.push(`emptyBody.ur does not state ${wantUr} (Urdu digits for ${total})`);

// A wrong count is worse than a missing one — catch a stale number that is
// still syntactically present, and catch the two languages disagreeing.
for (const [name, text, want] of [["en", en, wantEn], ["ur", ur, wantUr]]) {
  const others = (text?.match(/\b\d{2,4}\b/g) ?? []).filter((n) => n !== want);
  const urOthers = name === "ur" ? (text?.match(/[۰-۹]{2,4}/g) ?? []).filter((n) => n !== want) : [];
  const stale = [...others, ...urOthers];
  if (stale.length) failures.push(`emptyBody.${name} also contains ${stale.join(", ")} — almost certainly a stale count`);
}

console.log(`corpus.json  : ${total} entries (shamail ${corpus.counts.shamail}, timeline ${corpus.counts.timeline})`);
console.log(`emptyBody.en : ${en === null ? "(not found)" : en.includes(wantEn) ? `states ${wantEn} ✔` : `MISSING ${wantEn} ✗`}`);
console.log(`emptyBody.ur : ${ur === null ? "(not found)" : ur.includes(wantUr) ? `states ${wantUr} ✔` : `MISSING ${wantUr} ✗`}`);

/* ── 2. The RTL script class in theme.ts ────────────────────────────────────
 *
 * `isRtlScript` decides text direction and metrics for the user's own echoed
 * message. It is a character class written as literal UTF-8, and inline UTF-8
 * has been mangled by tooling in this project already.
 *
 * A broken class fails OPEN: every string renders LTR, Urdu included, at
 * English metrics — losing the ﷺ leading fix (§12.0) on the one element that is
 * a verbatim echo of what the judge typed. Invisible until someone looks at a
 * device.
 */
const classMatch = theme.match(/const ARABIC_SCRIPT = (\/\[[^\n]*?\]\/[a-z]*)\s*;/);
if (!classMatch) {
  failures.push("could not find the ARABIC_SCRIPT character class in mobile/src/theme.ts");
} else {
  let re = null;
  try {
    re = new RegExp(classMatch[1].slice(1, classMatch[1].lastIndexOf("/")));
  } catch (e) {
    failures.push(`ARABIC_SCRIPT does not compile: ${e.message}`);
  }
  if (re) {
    // Roman-Urdu MUST be false. This is script detection, not language
    // detection — the `"he"` bug class (§5.4) lived in the latter, and the two
    // must not be conflated back together.
    const cases = [
      ["Urdu script", "حضور ﷺ کا اخلاق کیسا تھا؟", true],
      ["bare ﷺ ligature (U+FDFA)", "ﷺ", true],
      ["mixed Latin + Arabic", "The Prophet ﷺ was born in 571 CE", true],
      ["English", "What was his character like?", false],
      ["roman-Urdu", "huzoor ka akhlaq kaisa tha", false],
      ["roman-Urdu ruling phrasing", "kya jaiz hai", false],
    ];
    for (const [name, sample, want] of cases) {
      const got = re.test(sample);
      console.log(`  ${got === want ? "✔" : "✗"} ${name.padEnd(28)} rtl=${got}`);
      if (got !== want) failures.push(`ARABIC_SCRIPT: ${name} should be rtl=${want}, got ${got}`);
    }
  }
}

/* ── 3. The demo cache covers the chips the app actually shows ──────────────
 *
 * The chip text lives in mobile/src/strings.ts; the cached question list lives
 * in api/src/demo-questions.ts. Reword a chip without rebuilding the cache and
 * the app quietly stops being covered — the demo looks prepared and is not,
 * which is the specific failure the cache exists to prevent.
 *
 * ⚠️ The cache ships DISABLED (DEMO_CACHE is not set — see api/src/config.ts:
 * a sub-second answer reads as hardcoded). This check is kept running anyway,
 * because the whole point of keeping the machinery is that it can be switched
 * on under quota pressure without a rebuild. A lever that has silently drifted
 * out of sync is not a lever, and the moment you need it is the worst moment
 * to discover the chips no longer match.
 *
 * Compares the chip strings, not the cache file: a stale demo-cache.json is
 * caught by its own gate at boot, but a chip that drifted out of the curated
 * list has nothing else watching it.
 */
const demoQuestions = readFileSync(join(root, "api", "src", "demo-questions.ts"), "utf8");

function chipText(key, langKey) {
  const line = strings.match(new RegExp(`${key}:\\s*\\{[^}]*${langKey}:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  return line ? line[1] : null;
}

const chips = [];
for (const key of ["exampleInCorpus", "exampleOutOfCorpus", "exampleRuling"])
  for (const l of ["en", "ur"]) chips.push([`${key}.${l}`, chipText(key, l)]);

console.log("\nchips covered by the demo cache:");
for (const [name, text] of chips) {
  if (text === null) {
    failures.push(`could not read ${name} from strings.ts`);
    continue;
  }
  // The curated list stores the question verbatim, so a literal search is the
  // right check — anything fuzzier would pass on a near-miss, which is exactly
  // the case that breaks.
  const covered = demoQuestions.includes(text);
  console.log(`  ${covered ? "✔" : "✗"} ${name.padEnd(26)} ${text.slice(0, 46)}`);
  if (!covered) {
    failures.push(
      `${name} is not in api/src/demo-questions.ts — reword the chip and the demo cache stops covering it`
    );
  }
}

/* ── 4. The lever is still valid against the current corpus ────────────────
 *
 * The cache is off, so nothing consults its gate at runtime. That is exactly
 * why this is checked here: a lever whose gate has silently gone stale looks
 * like insurance and is not, and the moment you reach for it is the worst
 * moment to find out. A mismatch here is not a failure — it is a rebuild.
 */
const demoCache = JSON.parse(readFileSync(join(root, "demo-cache.json"), "utf8"));
const cacheEntries = Object.keys(demoCache.entries ?? {}).length;
const gateOk = demoCache.gate?.corpusVersion === corpus.corpusVersion;
console.log(
  `\ndemo cache   : ${cacheEntries} entries, corpus ${demoCache.gate?.corpusVersion} ` +
    `${gateOk ? "✔ matches corpus.json" : `✗ corpus.json is ${corpus.corpusVersion}`} (feature OFF by design)`
);
if (!cacheEntries) failures.push("demo-cache.json has no entries — the lever would do nothing if pulled");
if (!gateOk) {
  failures.push(
    `demo-cache.json was built against corpus ${demoCache.gate?.corpusVersion}, corpus.json is now ` +
      `${corpus.corpusVersion} — the gate would refuse the whole file. Re-run demo-cache:build.`
  );
}

if (failures.length) {
  console.error("\nshell:check FAILED");
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

console.log(`\nshell:${check ? "check" : "report"} ok — the app's corpus claim and its RTL class both hold.`);
