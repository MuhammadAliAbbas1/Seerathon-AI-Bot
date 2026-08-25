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

/* ── 2. What METRICS come out of theme.ts for a given string ────────────────
 *
 * ⚠️ THIS TESTS THE CONSUMER, NOT THE CHARACTER CLASS. That distinction is the
 * whole reason this section was rewritten on 2026-08-25, and it is the fourth
 * instance of "verification does not spread" (CLAUDE.md §5.6).
 *
 * The previous version evaluated the class in isolation and asserted:
 *
 *     ["mixed Latin + Arabic", "The Prophet ﷺ was born in 571 CE", true]
 *
 * That assertion was CORRECT about the class — the string does contain Arabic
 * script — and it encoded the shipped bug as expected behaviour, so it could
 * never catch it. `bodyStyleForText` consumed that yes/no as "this string is
 * Urdu" and handed an English sentence Urdu metrics (19/38) and RTL. Two of the
 * six chip strings carry ﷺ, so two of them rendered the judge's own English
 * question oversized and right-aligned next to a correctly-sized bot bubble —
 * including the one behind the README's hero screenshot.
 *
 * A guard on a primitive proves nothing about the caller that misreads it. So
 * this now runs the REAL detection source — the block between the rtl-detect
 * markers in theme.ts, not a copy of its logic — and asserts the fontSize and
 * lineHeight that actually reach the screen.
 *
 * ⚠️ STILL TRUE, AND STILL THE RULE: do not ask this what LANGUAGE a string is.
 * It answers "which script dominates", which is right for direction and metrics
 * on text the user typed, and wrong for language. A rehearsal validator built
 * on the old class flagged all five English citations of a perfectly good
 * answer as script-mismatched — a false failure in the instrument, on a run
 * whose entire purpose was checking the system. For language, compare against
 * the corpus's own `en`/`ur` blocks, which is what §5.3 check 3 already does.
 */
// `chipText` is declared in section 3 below; function declarations hoist, so it
// is callable here. The chip strings are read from strings.ts rather than
// duplicated, so rewording a chip re-tests the new text automatically.
const rtlBlock = theme.match(/rtl-detect:start[^\n]*\n([\s\S]*?)\/\/ ── rtl-detect:end/);
// Read off the line rather than building a regex from a template literal: `\b`
// inside a template literal is a BACKSPACE escape, not a word boundary, which
// silently produced /body:s*{s*.../ and matched nothing. Regex literals below
// are immune to that whole class of escaping error.
const metricsOf = (key) => {
  const line = theme.split("\n").find((l) => l.trim().startsWith(key + ":"));
  if (!line) return null;
  const size = line.match(/fontSize:\s*([\d.]+)/);
  const height = line.match(/lineHeight:\s*([\d.]+)/);
  return size && height ? { fontSize: +size[1], lineHeight: +height[1] } : null;
};
const EN_METRICS = metricsOf("body");
const UR_METRICS = metricsOf("bodyUr");

if (!rtlBlock) {
  failures.push("could not find the rtl-detect block in mobile/src/theme.ts");
} else if (!EN_METRICS || !UR_METRICS) {
  failures.push("could not read type.body / type.bodyUr metrics from mobile/src/theme.ts");
} else {
  // Strip TS so the real source can be evaluated as JS. If this strip ever
  // fails to produce a working function the constructor throws, which is loud —
  // it cannot degrade into silently testing nothing.
  let isRtlScript = null;
  try {
    const js = rtlBlock[1]
      .replace(/\bexport\s+/g, "")
      .replace(/:\s*(string|RegExp|number|boolean)\b/g, "");
    isRtlScript = new Function(`${js}\nreturn isRtlScript;`)();
    if (typeof isRtlScript !== "function") throw new Error("isRtlScript is not a function");
  } catch (e) {
    failures.push(`the rtl-detect block does not evaluate: ${e.message}`);
    isRtlScript = null;
  }

  if (isRtlScript) {
    // Roman-Urdu MUST resolve to English metrics. This is script detection, not
    // language detection — the `"he"` bug class (§5.4) lived in the latter, and
    // the two must not be conflated back together.
    const cases = [
      // All six chip strings. Two of these were wrong and nothing noticed.
      ["chip exampleInCorpus.en", chipText("exampleInCorpus", "en"), "en"],
      ["chip exampleOutOfCorpus.en", chipText("exampleOutOfCorpus", "en"), "en"],
      ["chip exampleRuling.en", chipText("exampleRuling", "en"), "en"],
      ["chip exampleInCorpus.ur", chipText("exampleInCorpus", "ur"), "ur"],
      ["chip exampleOutOfCorpus.ur", chipText("exampleOutOfCorpus", "ur"), "ur"],
      ["chip exampleRuling.ur", chipText("exampleRuling", "ur"), "ur"],
      // The regression case itself, now asserting the opposite of what the old
      // guard asserted. If this ever flips back to `ur`, presence has returned.
      ["English + ﷺ honorific", "The Prophet ﷺ was born in 571 CE", "en"],
      ["bare ﷺ ligature (U+FDFA)", "ﷺ", "ur"],
      ["Urdu with a Latin name", "کیا حضور ﷺ نے Makkah میں یہ فرمایا؟", "ur"],
      ["English, no honorific", "What was his character like?", "en"],
      ["roman-Urdu", "huzoor ka akhlaq kaisa tha", "en"],
      ["roman-Urdu ruling phrasing", "kya jaiz hai", "en"],
      // Ties resolve to LTR. Digits and punctuation are script-neutral and must
      // not vote, so neither of these has a majority either way.
      ["empty string (tie → LTR)", "", "en"],
      ["digits only (tie → LTR)", "1445 / 571", "en"],
    ];

    console.log("\nmetrics chosen for user-authored text:");
    for (const [name, sample, want] of cases) {
      if (sample === null) {
        failures.push(`could not read the chip string for ${name} from strings.ts`);
        continue;
      }
      const got = isRtlScript(sample) ? "ur" : "en";
      const m = got === "ur" ? UR_METRICS : EN_METRICS;
      const ok = got === want;
      console.log(`  ${ok ? "✔" : "✗"} ${name.padEnd(28)} ${got} ${m.fontSize}/${m.lineHeight}`);
      if (!ok) {
        const wm = want === "ur" ? UR_METRICS : EN_METRICS;
        failures.push(
          `${name} should render at ${want} metrics (${wm.fontSize}/${wm.lineHeight}), got ${got} (${m.fontSize}/${m.lineHeight})`
        );
      }
    }

    // The two character classes carry /g. `String.prototype.match` resets
    // lastIndex, but `RegExp.test` does not — so if anyone switches this to
    // .test() the answer starts alternating per call. Cheap to pin, and the
    // symptom would otherwise be a bubble that renders differently on re-render.
    const twice = "حضور ﷺ کا اخلاق کیسا تھا؟";
    if (isRtlScript(twice) !== isRtlScript(twice)) {
      failures.push("isRtlScript is not stable across calls — a /g regex is holding lastIndex");
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

// The gate compares eight fields at boot; the three that actually move during
// development are the corpus version and the two prompt versions. A prompt bump
// is the likeliest way this goes stale, because it happens for reasons that
// have nothing to do with the cache — so it is the one to catch here rather
// than at boot, where nobody is watching while the feature is off.
const prompts = readFileSync(join(root, "api", "src", "prompts.ts"), "utf8");
const literal = (name) => prompts.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`))?.[1] ?? null;
// Scoped to the PROMPT_VERSION_BY_OP block. A bare /answer:\s*"…"/ would also
// match SCHEMA_VERSION_BY_OP's `answer` a few lines below, and would start
// reading the wrong one the day those two blocks swap order.
const answerPrompt =
  prompts.match(/PROMPT_VERSION_BY_OP\s*=\s*\{[^}]*answer:\s*"([^"]+)"/)?.[1] ?? null;

const expected = {
  corpusVersion: corpus.corpusVersion,
  classifyPromptVersion: literal("PROMPT_VERSION"),
  answerPromptVersion: answerPrompt,
};

console.log(`\ndemo cache   : ${cacheEntries} entries (feature OFF by design — checked anyway)`);
if (!cacheEntries) failures.push("demo-cache.json has no entries — the lever would do nothing if pulled");
for (const [field, want] of Object.entries(expected)) {
  if (want === null) {
    failures.push(`could not read ${field} out of api/src/prompts.ts`);
    continue;
  }
  const got = demoCache.gate?.[field];
  console.log(`  ${got === want ? "✔" : "✗"} ${field.padEnd(23)} ${got}${got === want ? "" : `  (runtime: ${want})`}`);
  if (got !== want) {
    failures.push(
      `demo-cache.json gate.${field} is "${got}" but the runtime is "${want}" — the gate would refuse ` +
        `the WHOLE file at boot, so the lever is dead. Re-record and re-run demo-cache:build.`
    );
  }
}

if (failures.length) {
  console.error("\nshell:check FAILED");
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

console.log(`\nshell:${check ? "check" : "report"} ok — the app's corpus claim holds and every chip renders at the right metrics.`);
