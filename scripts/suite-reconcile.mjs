#!/usr/bin/env node
// Reconciles tests/adversarial.md (the document) against what is actually
// executable: the live batch runner and the recorded fixtures.
//
//   node scripts/suite-reconcile.mjs
//
// Costs nothing. Exists because a document and a hand-typed runner that are
// supposed to describe the same thing will drift, and F8 already showed that a
// case can sit in the suite looking green while never executing at all.

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ── 1. Parse the document ────────────────────────────────────────────── */

const md = readFileSync(join(ROOT, "tests", "adversarial.md"), "utf8");

const documented = [];
let section = null;
for (const line of md.split("\n")) {
  const head = line.match(/^##\s+([A-Z])\.\s+(.*)$/);
  if (head) {
    section = { letter: head[1], title: head[2].trim() };
    continue;
  }
  // A case row starts with | <ID> | where ID is a section letter + digits.
  const row = line.match(/^\|\s*([A-Z]\d+[a-z]?)\s*\|(.*)$/);
  if (!row || !section) continue;
  const id = row[1];
  if (id[0] !== section.letter) continue; // not a case row for this section
  const cells = row[2].split("|").map((c) => c.trim());
  const text = cells.join(" ");
  documented.push({
    id,
    section: section.letter,
    question: cells[0] ?? "",
    live: text.includes("🔴"),
    markedVerified: text.includes("✅"),
  });
}

/* ── 2. What the runners actually execute ─────────────────────────────── */

function runnerCases(file) {
  const src = readFileSync(join(ROOT, file), "utf8");
  const out = [];
  const re = /\{\s*id:\s*"([^"]+)"[^}]*?q:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(src))) out.push({ id: m[1], q: JSON.parse(`"${m[2]}"`), file });
  return out;
}

const runner = [
  ...runnerCases("api/scripts/record-answers.ts"),
  ...runnerCases("api/scripts/record-batch.ts"),
];

/* ── 3. Which questions have genuine fixtures ─────────────────────────── */

const fixtures = [];
const dir = join(ROOT, "api", "fixtures");
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
  fixtures.push({ file: f, op: j.meta?.op, question: j.meta?.question, ok: j.outcome?.ok, failure: j.outcome?.failure });
}
const norm = (q) => (q ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const fixtureByQuestion = new Map();
for (const fx of fixtures) {
  const k = norm(fx.question);
  if (!fixtureByQuestion.has(k)) fixtureByQuestion.set(k, []);
  fixtureByQuestion.get(k).push(fx);
}

/* ── 4. Report ────────────────────────────────────────────────────────── */

const bySection = new Map();
for (const c of documented) {
  if (!bySection.has(c.section)) bySection.set(c.section, []);
  bySection.get(c.section).push(c);
}

console.log("DOCUMENTED CASES BY SECTION");
let total = 0;
let liveTotal = 0;
for (const [letter, cases] of [...bySection].sort()) {
  const live = cases.filter((c) => c.live).length;
  total += cases.length;
  liveTotal += live;
  console.log(`  ${letter}: ${String(cases.length).padStart(2)} cases  (${live} marked live)`);
}
console.log(`  ─────────────────────────`);
console.log(`  TOTAL: ${total} cases, ${liveTotal} marked live (🔴)`);

const claimed = md.match(/\*\*Total:\s*(\d+)\s*cases/);
console.log(`  Document claims: ${claimed ? claimed[1] : "?"} ${claimed && Number(claimed[1]) !== total ? "  ← MISMATCH" : ""}`);

console.log("\nRUNNER CASES");
console.log(`  ${runner.length} cases across the batch scripts`);
const runnerIds = new Set(runner.map((r) => r.id));
const docIds = new Set(documented.map((c) => c.id));
const collisions = [...runnerIds].filter((id) => docIds.has(id));
const orphanRunner = [...runnerIds].filter((id) => !docIds.has(id));

console.log("\nID COLLISIONS (same id, check the question actually matches)");
let realCollision = 0;
for (const id of collisions.sort()) {
  const r = runner.find((x) => x.id === id);
  const d = documented.find((x) => x.id === id);
  const same = norm(r.q).slice(0, 40) === norm(d.question).replace(/^🔴\s*/, "").slice(0, 40);
  if (!same) {
    realCollision++;
    console.log(`  ✗ ${id}`);
    console.log(`      doc:    ${norm(d.question).slice(0, 70)}`);
    console.log(`      runner: ${norm(r.q).slice(0, 70)}`);
  }
}
if (!realCollision) console.log("  none");

if (orphanRunner.length) {
  console.log("\nRUNNER IDS NOT IN THE DOCUMENT");
  for (const id of orphanRunner.sort()) console.log(`  ${id}  ${norm(runner.find((x) => x.id === id).q).slice(0, 60)}`);
}

console.log("\nLIVE (🔴) CASES — is there a genuine fixture?");
const needsRun = [];
for (const c of documented.filter((x) => x.live)) {
  const q = norm(c.question.replace(/^🔴\s*/, ""));
  const inRunner = runner.find((r) => norm(r.q) === q);
  const fx = fixtureByQuestion.get(q) ?? (inRunner ? fixtureByQuestion.get(norm(inRunner.q)) : undefined);
  const ops = fx ? [...new Set(fx.map((x) => x.op))].sort().join("+") : "";
  const status = fx ? `fixture (${ops})` : inRunner ? "in runner, NO fixture" : "NOT IN RUNNER";
  if (!fx) needsRun.push({ id: c.id, inRunner: !!inRunner, q });
  console.log(`  ${c.id.padEnd(4)} ${status.padEnd(24)} ${q.slice(0, 52)}`);
}

console.log("\nSUMMARY");
console.log(`  documented cases        : ${total}`);
console.log(`  marked live (🔴)        : ${liveTotal}`);
console.log(`  live WITH a fixture     : ${liveTotal - needsRun.length}`);
console.log(`  live WITHOUT a fixture  : ${needsRun.length}`);
console.log(`    ├─ present in a runner: ${needsRun.filter((n) => n.inRunner).length}  (never run)`);
console.log(`    └─ absent from runners: ${needsRun.filter((n) => !n.inRunner).length}  (not executable at all)`);
