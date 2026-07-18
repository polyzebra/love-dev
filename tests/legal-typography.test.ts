/**
 * Legal typography + section-reference guard (LEGAL TYPOGRAPHY HARDENING).
 *
 * Fails when authored legal content contains:
 *   - U+2014 em dash
 *   - U+2013 en dash
 *   - a doubled section symbol
 *   - a malformed section range (a single section symbol on a numeric range,
 *     e.g. a range missing the second section symbol)
 *
 * Scope: the authored legal surface only -
 *   docs/ legal masters, src/app/(marketing)/legal, src/components/legal,
 *   src/lib/legal. Pure source scan: no DB, no env (UNIT lane).
 *
 * The mandated forms are documented in docs/LEGAL-STYLE-STANDARD.md.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const EM = "—"; // em dash
const EN = "–"; // en dash
const DOUBLE_SECTION = "§§"; // doubled section symbol
// A section symbol + number joined by a hyphen/dash to another number, i.e. a
// range whose second endpoint is missing its own section symbol.
const MALFORMED_RANGE = /§\d+(?:\.\d+)?\s*[-–—]\s*\d/;

const ROOT = process.cwd();

function walk(dir: string, out: string[]) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|md)$/.test(name)) out.push(full);
  }
}

function legalDocs(): string[] {
  const docs = path.join(ROOT, "docs");
  if (!existsSync(docs)) return [];
  return readdirSync(docs)
    .filter((n) => n.endsWith(".md") && (/^L\d/.test(n) || n.startsWith("LEGAL-")))
    .map((n) => path.join(docs, n));
}

const files: string[] = [...legalDocs()];
for (const d of [
  "src/app/(marketing)/legal",
  "src/components/legal",
  "src/lib/legal",
]) {
  walk(path.join(ROOT, d), files);
}

type Violation = { file: string; line: number; text: string; message: string; expected: string };
const violations: Violation[] = [];

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const n = i + 1;
    const snippet = line.trim().slice(0, 80);
    if (line.includes(EM))
      violations.push({
        file: rel,
        line: n,
        text: snippet,
        message: "Forbidden em dash found.",
        expected: `Use "-" instead of "${EM}".`,
      });
    if (line.includes(EN))
      violations.push({
        file: rel,
        line: n,
        text: snippet,
        message: "Forbidden en dash found.",
        expected: `Use "-" instead of "${EN}".`,
      });
    if (line.includes(DOUBLE_SECTION))
      violations.push({
        file: rel,
        line: n,
        text: snippet,
        message: "Doubled section symbol found.",
        expected: `Use a single section symbol per reference, e.g. "§24-§29".`,
      });
    const m = MALFORMED_RANGE.exec(line);
    if (m)
      violations.push({
        file: rel,
        line: n,
        text: snippet,
        message: `Malformed section range "${m[0]}".`,
        expected: `Repeat the section symbol on both ends, e.g. "§24-§29".`,
      });
  });
}

if (violations.length > 0) {
  console.error(`\nLEGAL TYPOGRAPHY GUARD: ${violations.length} violation(s) FOUND\n`);
  for (const v of violations) {
    console.error(`${v.file}:${v.line}`);
    console.error(`  ${v.message}`);
    console.error(`  ${v.expected}`);
    console.error(`  > ${v.text}`);
  }
  console.error(`\nFAILED: ${violations.length} legal typography violation(s).`);
  process.exit(1);
}

console.log(`  ok - scanned ${files.length} legal files, 0 typography violations`);
console.log(`legal-typography: 1 check passed`);
process.exit(0);
