#!/usr/bin/env node
// Copies api/src/contract.ts → mobile/src/contract.ts.
//
//   npm run contract:sync    write the copy
//   npm run contract:check   fail if they have drifted (for CI / pre-commit)
//
// This is the mitigation promised when we chose no-monorepo (Decision 3) and
// then did not build for three phases. Two sibling packages with no workspace
// linking keeps EAS Build simple, but it means nothing stops the request
// contract being written twice and quietly diverging — which is exactly what
// happened to `Mode`.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "api", "src", "contract.ts");
const TARGET = join(ROOT, "mobile", "src", "contract.ts");

const BANNER = `// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  GENERATED FILE — DO NOT EDIT.                                           ║
// ║                                                                          ║
// ║  Source: api/src/contract.ts                                             ║
// ║  Regenerate: npm run contract:sync                                       ║
// ║  Verify:     npm run contract:check                                      ║
// ║                                                                          ║
// ║  Edits here are overwritten and will fail contract:check.                 ║
// ╚══════════════════════════════════════════════════════════════════════════╝

`;

const check = process.argv.includes("--check");
const wanted = BANNER + readFileSync(SOURCE, "utf8");

if (check) {
  let actual = "";
  try {
    actual = readFileSync(TARGET, "utf8");
  } catch {
    console.error("contract:check FAILED — mobile/src/contract.ts is missing.\n  Run: npm run contract:sync");
    process.exit(1);
  }
  // Compare ignoring line endings: git normalises to CRLF on checkout here.
  const norm = (s) => s.replace(/\r\n/g, "\n");
  if (norm(actual) !== norm(wanted)) {
    console.error(
      "contract:check FAILED — the app and server contracts have DRIFTED.\n" +
        "  The wire shape is defined once, in api/src/contract.ts.\n" +
        "  Run: npm run contract:sync"
    );
    process.exit(1);
  }
  console.log("contract:check ok — app and server agree on the wire shape.");
} else {
  writeFileSync(TARGET, wanted, "utf8");
  console.log("contract:sync — wrote mobile/src/contract.ts from api/src/contract.ts");
}
