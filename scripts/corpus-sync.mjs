#!/usr/bin/env node
// Bake the Seerathon corpus to disk. Run: npm run corpus:sync
//
// Fetches the full corpus (both languages, hikayat included) and writes a
// normalised corpus.json. Disk is free; context is not (CLAUDE.md §4B) —
// so we bake EVERYTHING and let the runtime choose what enters the prompt.
//
// Zero dependencies on purpose: this is a build-time script, it runs once,
// and it never ships to production. Node 20+ has native fetch.
//
// API gotchas this script is built around (CLAUDE.md §4):
//   - NEVER send an Authorization header — any value returns 403.
//   - Errors come back as HTTP 200 with body.error === true. res.ok is
//     true for every failure this API produces, so branch on body.error.
//   - ids are 24-char hex strings; slugs are NOT unique. Key by id only.

import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = "https://api.islamicdesk.com/api/seerathon/corpus";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "corpus.json");

const warnings = [];
const warn = (m) => { warnings.push(m); console.warn("  ⚠  " + m); };

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------

async function get(path, attempt = 1) {
  const url = BASE + path;
  let body;
  try {
    // The whole read must sit inside the try, not just fetch(). The hikayat
    // payload is ~800 KB and the abort signal can fire while the body is
    // still streaming — if res.json() were outside, that timeout would
    // escape the retry entirely.
    // No Authorization header. Not an oversight — see header comment.
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(180000),
    });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    body = await res.json();
  } catch (err) {
    if (attempt >= 3) throw new Error(`failed on ${path} after 3 attempts: ${err.cause?.code || err.message || err.name}`);
    console.warn(`  …retrying ${path} (attempt ${attempt} failed: ${err.cause?.code || err.message || err.name})`);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
    return get(path, attempt + 1);
  }
  // The load-bearing check: this API signals failure in the body, not the status.
  if (body.error) throw new Error(`${path} returned error: ${body.msg}`);
  return body.data;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const text = (v) => (typeof v === "string" ? v.trim() : "");
const nonEmpty = (v) => text(v).length > 0;
const list = (v) => (Array.isArray(v) ? v.filter(nonEmpty).map(text) : []);

// The corpus encodes year/age RANGES as floats, and the float representation
// silently drops trailing zeros: 579.58 means 579–580, not 579–58. Rebuild by
// padding the decimal to the same digit count as the integer part.
// Raw value is always preserved alongside the label.
function rangeLabel(value, suffix) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return `${value}${suffix}`;

  const raw = String(value);
  const dot = raw.indexOf(".");
  const head = raw.slice(0, dot);
  let tail = raw.slice(dot + 1);

  if (tail.length < head.length) tail = tail.padEnd(head.length, "0"); // 58 -> 580
  const a = Number(head);
  const b = Number(tail);
  if (!Number.isFinite(b)) return `${head}${suffix}`;
  const [lo, hi] = a <= b ? [a, b] : [b, a]; // one entry stores the pair reversed
  return lo === hi ? `${lo}${suffix}` : `${lo}–${hi}${suffix}`;
}

// ---------------------------------------------------------------------------
// normalise
// ---------------------------------------------------------------------------

function normaliseShamail(item) {
  const lang = (block) => {
    const b = block || {};
    const points = list(b.points);
    const out = {
      title: text(b.title),
      hadeesTarjama: text(b.hadeesTarjama),
      hadeesHawala: text(b.hadeesHawala),
      type: text(b.type),
      points,
      hikayat: text(b.hikayat),
    };
    // "Has a body" means "has something to ground an answer in". A title is
    // not content — CLAUDE.md §5.3 check 2 exists because of this.
    out.hasBody = nonEmpty(out.hadeesTarjama) || points.length > 0 || nonEmpty(out.hikayat);
    return out;
  };
  const en = lang(item.en);
  const ur = lang(item.ur);
  return {
    id: item.id,
    type: "shamail",
    slug: { en: text(item.slug?.en), romanUrdu: text(item.slug?.romanUrdu) },
    keywords: list(item.keywords),
    // category.id is NOT a reliable key: id "1" maps to two different names.
    // Always read the name off the entry (CLAUDE.md §4 / recon).
    category: {
      id: text(item.category?.id),
      name: { en: text(item.category?.name?.en), ur: text(item.category?.name?.ur) },
    },
    hasBody: { en: en.hasBody, ur: ur.hasBody },
    en,
    ur,
  };
}

function normaliseTimeline(item) {
  const lang = (block) => {
    const b = block || {};
    const content = (Array.isArray(b.content) ? b.content : []).map((c) => ({
      title: text(c.title),
      sequence: typeof c.sequence === "number" ? c.sequence : null,
      contentText: text(c.content_text),
    }));
    return {
      title: text(b.title),
      section: text(b.section),
      umarMubarak: b.umarMubarak ?? null,
      umarMubarakLabel: rangeLabel(b.umarMubarak, ""),
      gregorianDate: b.gregorianDate ?? null,
      gregorianDateLabel: rangeLabel(b.gregorianDate, " CE"),
      content,
      hasBody: content.some((c) => nonEmpty(c.contentText)),
    };
  };
  const en = lang(item.en);
  const ur = lang(item.ur);
  return {
    id: item.id,
    type: "timeline",
    slug: { en: text(item.slug?.en), romanUrdu: text(item.slug?.romanUrdu) },
    section: en.section || ur.section,
    umarMubarak: en.umarMubarak ?? ur.umarMubarak ?? null,
    umarMubarakLabel: en.umarMubarakLabel || ur.umarMubarakLabel,
    gregorianDate: en.gregorianDate ?? ur.gregorianDate ?? null,
    gregorianDateLabel: en.gregorianDateLabel || ur.gregorianDateLabel,
    hasBody: { en: en.hasBody, ur: ur.hasBody },
    en,
    ur,
  };
}

// ---------------------------------------------------------------------------
// routing index (CLAUDE.md §4B stage 1)
// ---------------------------------------------------------------------------
// One line per entry, every entry present. This is NOT retrieval — the model
// sees the complete corpus inventory and picks ids from it. Nothing can be
// missed because nothing was excluded.
//
// The body column is why this beats a plain title list: it lets the router
// avoid choosing an entry that has no text to ground an answer in, instead of
// discovering that later in §5.3 and falling back.

const bodyFlag = (h) => (h.en && h.ur ? "en+ur" : h.en ? "en" : h.ur ? "ur" : "NONE");

function indexLine(e) {
  const cells =
    e.type === "shamail"
      ? [e.id, "S", e.category.name.en, e.en.title, e.ur.title, e.keywords.join(","), bodyFlag(e.hasBody)]
      : [
          e.id,
          "T",
          e.section,
          e.en.title,
          e.ur.title,
          // "; " and not " | " — the pipe is the COLUMN separator. Using it
          // inside a cell would give timeline rows a different column count
          // from shamail rows, and the model has to parse this.
          [
            e.umarMubarakLabel ? "age " + e.umarMubarakLabel : "",
            e.gregorianDateLabel,
            e.en.content.map((c) => c.title).filter(Boolean).join("; "),
          ].filter(Boolean).join("; "),
          bodyFlag(e.hasBody),
        ];
  return cells.map((c) => String(c || "").replace(/\s+/g, " ").trim()).join(" | ");
}

const INDEX_HEADER =
  "# id | kind (S=shamail, T=timeline) | category or section | English title | Urdu title | keywords or date+subheadings | body languages available";

function buildIndex(entries) {
  return [INDEX_HEADER, ...entries.map(indexLine)].join("\n");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Fetching corpus from " + BASE + "\n");

  const meta = await get("/meta");
  console.log("  /meta            version=" + meta.version + "  counts=" + JSON.stringify(meta.counts));

  // limit caps at 120 and clamps silently above it; 120 covers both sources.
  const shamailData = await get("/shamail?limit=120&include_hikayat=true");
  console.log("  /shamail         " + shamailData.items.length + " of " + shamailData.total + " (hikayat included)");

  const timelineData = await get("/timeline?limit=120");
  console.log("  /timeline        " + timelineData.items.length + " of " + timelineData.total);

  // --- version consistency -------------------------------------------------
  const versions = new Set([meta.version, shamailData.corpus_version, timelineData.corpus_version].filter(Boolean));
  if (versions.size > 1) warn("corpus_version differs across endpoints: " + [...versions].join(", "));
  const corpusVersion = meta.version || shamailData.corpus_version || "unknown";

  let previous = null;
  try {
    previous = JSON.parse(await readFile(OUT, "utf8"));
  } catch {
    /* first run */
  }
  if (previous && previous.corpusVersion !== corpusVersion) {
    warn(
      `corpus_version CHANGED since last bake: ${previous.corpusVersion} -> ${corpusVersion}. ` +
        "Entry ids may have moved. Re-run the adversarial suite and re-record fixtures before trusting citations."
    );
  }

  // --- completeness --------------------------------------------------------
  if (shamailData.items.length !== shamailData.total) warn(`shamail truncated: got ${shamailData.items.length} of ${shamailData.total}`);
  if (timelineData.items.length !== timelineData.total) warn(`timeline truncated: got ${timelineData.items.length} of ${timelineData.total}`);
  if (meta.counts?.shamail !== shamailData.total) warn(`/meta says ${meta.counts?.shamail} shamail, list says ${shamailData.total}`);
  if (meta.counts?.seerah_timeline !== timelineData.total) warn(`/meta says ${meta.counts?.seerah_timeline} timeline, list says ${timelineData.total}`);

  // --- normalise -----------------------------------------------------------
  const entries = [
    ...shamailData.items.map(normaliseShamail),
    ...timelineData.items.map(normaliseTimeline),
  ];

  const byId = {};
  for (const e of entries) {
    if (!/^[a-f0-9]{24}$/.test(e.id)) warn(`unexpected id format: ${JSON.stringify(e.id)}`);
    if (byId[e.id]) warn(`duplicate id ${e.id} — later entry overwrites earlier`);
    byId[e.id] = e;
  }

  const usable = entries.filter((e) => e.hasBody.en || e.hasBody.ur);
  const empty = entries.filter((e) => !e.hasBody.en && !e.hasBody.ur);
  for (const e of empty) warn(`entry ${e.id} has NO body in either language ("${e.en.title}") — citable but groundless, see §5.3`);

  const index = buildIndex(entries);

  const out = {
    corpusVersion,
    builtAt: new Date().toISOString(),
    source: BASE,
    counts: {
      shamail: shamailData.total,
      timeline: timelineData.total,
      total: entries.length,
      usable: usable.length,
      withBodyEn: entries.filter((e) => e.hasBody.en).length,
      withBodyUr: entries.filter((e) => e.hasBody.ur).length,
    },
    // Verbatim from /meta. CLAUDE.md §4: reproduce exactly, do not reword.
    disclaimer: meta.disclaimer,
    usageRules: meta.usage_rules,
    index,
    indexChars: index.length,
    byId,
  };

  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");

  const kb = (n) => (n / 1024).toFixed(1) + " KB";
  console.log("\nWrote corpus.json");
  console.log("  corpusVersion  " + corpusVersion);
  console.log("  entries        " + entries.length + " (" + usable.length + " usable, " + empty.length + " empty)");
  console.log("  body coverage  en " + out.counts.withBodyEn + "/" + entries.length + "   ur " + out.counts.withBodyUr + "/" + entries.length);
  console.log("  file size      " + kb(JSON.stringify(out).length));
  console.log("  routing index  " + index.length + " chars, " + (index.split("\n").length - 1) + " entry lines");
  console.log(warnings.length ? `\n${warnings.length} warning(s) above.` : "\nNo warnings.");
}

main().catch((err) => {
  console.error("\ncorpus:sync FAILED — " + err.message);
  process.exit(1);
});
