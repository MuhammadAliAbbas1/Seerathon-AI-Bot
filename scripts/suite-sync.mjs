#!/usr/bin/env node
// Writes the case TABLES in tests/adversarial.md from tests/cases.ts.
//
//   npm run suite:sync     rewrite the tables
//   npm run suite:check    fail if they have drifted (CI / pre-commit)
//
// Same shape as contract-sync: one source of truth, a generated copy, and a
// check that fails on drift. Applied here because the document and the runner
// were maintained separately and diverged — 8 cases sat in the document
// claiming coverage while appearing in no runner at all.
//
// ⚠️ ONLY the tables are generated, and only between the markers. Every word of
// prose in that file — the F8 story, the A7/A8 note, the group I analysis — is
// hand-written and is the valuable part. Generating it would be a downgrade.
//
// ⚠️ The Ratchet column is COMPUTED by calling rulingRatchet(). The document
// once asserted F5 was caught by the ratchet when the list held "permissible"
// and not "permitted". A ratchet miss costs nothing by design; a document
// asserting coverage that does not exist is how you stop testing something.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SECTIONS } from "../tests/cases.ts";
import { rulingRatchet } from "../api/src/ruling-keywords.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = join(ROOT, "tests", "adversarial.md");

const BEGIN = (l) => `<!-- BEGIN GENERATED ${l} — edit tests/cases.ts, then npm run suite:sync -->`;
const END = (l) => `<!-- END GENERATED ${l} -->`;

const cell = (v) => (v ?? "").replace(/\|/g, "\\|");

function renderSection(section) {
  const head = `| # | ${section.columns.join(" | ")} |`;
  const rule = `|---|${section.columns.map(() => "---").join("|")}|`;
  const rows = section.cases.map((c) => {
    const cells = [];
    for (const col of section.columns) {
      switch (col) {
        case "Question":
          cells.push(`${c.live ? "🔴 " : ""}${cell(c.question)}`);
          break;
        case "Scenario":
        case "Injected router response":
        case "Injected response":
          cells.push(cell(c.scenario));
          break;
        case "Lang":
          cells.push(c.lang ?? "");
          break;
        case "Expected":
          cells.push(cell(c.expected));
          break;
        case "Ratchet":
          // Computed. Never declared.
          cells.push(c.question ? (rulingRatchet(c.question).hit ? "✅ hit" : "❌ miss") : "—");
          break;
        case "Covered by":
          cells.push(cell(c.coveredBy));
          break;
        case "Tier":
          cells.push(c.status ? cell(c.status) : c.live ? "🔴 model" : "⚪ offline");
          break;
        default:
          cells.push("");
      }
    }
    return `| ${c.id} | ${cells.join(" | ")} |`;
  });
  return [head, rule, ...rows].join("\n");
}

let doc = readFileSync(DOC, "utf8");
let missing = [];

for (const section of SECTIONS) {
  const begin = BEGIN(section.letter);
  const end = END(section.letter);
  const bi = doc.indexOf(begin);
  const ei = doc.indexOf(end);
  if (bi === -1 || ei === -1) {
    missing.push(section.letter);
    continue;
  }
  doc = doc.slice(0, bi + begin.length) + "\n" + renderSection(section) + "\n" + doc.slice(ei);
}

// Totals, so the document can never claim a count it does not contain.
const total = SECTIONS.reduce((n, s) => n + s.cases.length, 0);
const live = SECTIONS.reduce((n, s) => n + s.cases.filter((c) => c.live).length, 0);
const executable = SECTIONS.reduce((n, s) => n + s.cases.filter((c) => c.question).length, 0);
const totalsBegin = BEGIN("TOTALS");
const totalsEnd = END("TOTALS");
const tb = doc.indexOf(totalsBegin);
const te = doc.indexOf(totalsEnd);
if (tb === -1 || te === -1) missing.push("TOTALS");
else {
  const body =
    `**${total} cases.** ${executable} are literal questions we can send; ` +
    `${total - executable} are scenarios covered by the offline suite. ` +
    `**${live} are marked 🔴** and need a real model response.`;
  doc = doc.slice(0, tb + totalsBegin.length) + "\n\n" + body + "\n\n" + doc.slice(te);
}

if (missing.length) {
  console.error(`suite:sync FAILED — missing generated markers for: ${missing.join(", ")}`);
  console.error(`  Add ${BEGIN("X")} / ${END("X")} around each table in tests/adversarial.md`);
  process.exit(1);
}

const check = process.argv.includes("--check");
const current = readFileSync(DOC, "utf8");
const norm = (s) => s.replace(/\r\n/g, "\n");

if (check) {
  if (norm(current) !== norm(doc)) {
    console.error(
      "suite:check FAILED — tests/adversarial.md has DRIFTED from tests/cases.ts.\n" +
        "  Cases are defined once, in tests/cases.ts.\n" +
        "  Run: npm run suite:sync"
    );
    process.exit(1);
  }
  console.log(`suite:check ok — ${total} cases, document matches tests/cases.ts.`);
} else {
  writeFileSync(DOC, doc, "utf8");
  console.log(`suite:sync — wrote ${SECTIONS.length} tables, ${total} cases (${live} live, ${executable} executable).`);
}
