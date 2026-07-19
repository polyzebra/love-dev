/**
 * L5.3 - PUBLIC LAYOUT GOVERNANCE GUARD (unit, no DB).
 *
 * Makes public-layout drift impossible to introduce accidentally. Runs in the
 * `unit` lane (CI + local + pre-commit), so a PR that hardcodes a page frame,
 * nests a <main>, duplicates the section rhythm, or forks the token source is
 * REJECTED before merge. See docs/LAYOUT_GUIDE.md.
 *
 * The single source of truth is src/components/layout/public.tsx. Public pages
 * must compose its primitives (PageShell / Container / Section / CardGrid /
 * CTAGroup); they may never construct their own page frame.
 *
 * These rules target the LAYOUT FRAME only (mx-auto page container + padding,
 * <main>, the shared section rhythm). Content measures on inner elements
 * (max-w-lg / max-w-md / max-w-xs on a paragraph or card, or a hero text block)
 * are intentionally allowed - they are typography, not layout architecture.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MARKETING = "src/app/(marketing)";
const LAYOUT_SRC = "src/components/layout/public.tsx";

function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  let out: string[] = [];
  for (const entry of readdirSync(abs)) {
    const rel = path.join(dir, entry);
    if (statSync(path.join(ROOT, rel)).isDirectory()) out = out.concat(walk(rel));
    else out.push(rel);
  }
  return out;
}
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

// A page FRAME = a centred container with a page width AND horizontal padding
// in one className. That is exactly what <PageShell>/<Container> exist to own.
const PAGE_FRAME =
  /className="[^"]*\bmx-auto\b[^"]*\bmax-w-(?:2xl|3xl|4xl|5xl|6xl|\[[0-9.]+rem\])\b[^"]*\bpx-(?:4|5|6|8|10)\b/;
// The layout's own page frame written INSIDE a className literal (never allowed
// in a page); the shared primitives compose tokens, not a literal like this.
const RAW_MAIN = /<main[\s>]/;
const RAW_SECTION_RHYTHM = /\bmt-20 md:mt-28\b/;

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

function main() {
  const pages = walk(MARKETING).filter((f) => f.endsWith("page.tsx"));
  assert.ok(pages.length >= 10, `expected the marketing pages to be present, found ${pages.length}`);

  console.log(`1. no public page constructs its own layout frame (${pages.length} pages)`);
  for (const f of pages) {
    const src = read(f);
    const short = f.replace(MARKETING + "/", "");
    check(`${short}: renders no <main> (the layout owns the sole <main>)`, () => {
      assert.ok(!RAW_MAIN.test(src), `${short} renders a nested <main> - use <PageShell>`);
    });
    check(`${short}: no hardcoded page-frame container (use PageShell/Container)`, () => {
      assert.ok(!PAGE_FRAME.test(src), `${short} hardcodes a page frame - use <PageShell width=...>`);
    });
    check(`${short}: no duplicated section rhythm (use layout.section)`, () => {
      assert.ok(!RAW_SECTION_RHYTHM.test(src), `${short} hardcodes 'mt-20 md:mt-28' - use layout.section`);
    });
  }

  console.log("2. shared chrome (nav, footer, hero, legal shell) frames come from tokens too");
  const chrome = [
    ...walk("src/components/marketing").filter((f) => f.endsWith(".tsx")),
    "src/components/legal/legal-chrome.tsx",
  ];
  for (const f of chrome) {
    if (f === LAYOUT_SRC) continue;
    const src = read(f);
    const short = f.replace("src/components/", "");
    check(`${short}: no hardcoded page-frame container`, () => {
      assert.ok(!PAGE_FRAME.test(src), `${short} hardcodes a page frame - compose layout tokens`);
    });
  }

  console.log("3. ONE source of truth for the layout tokens");
  check("the `layout` token map is defined in exactly one file", () => {
    const defs = walk("src")
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
      .filter((f) => /export const layout\s*=/.test(read(f)));
    assert.deepEqual(defs, [LAYOUT_SRC], `layout tokens must live only in ${LAYOUT_SRC}, found: ${defs.join(", ")}`);
  });
  check("the layout source exports the required primitives", () => {
    const src = read(LAYOUT_SRC);
    for (const name of ["PageShell", "Container", "Section", "CardGrid", "CTAGroup", "layout"]) {
      assert.ok(new RegExp(`export (function|const) ${name}\\b`).test(src), `missing primitive: ${name}`);
    }
  });

  console.log(`\n${passed} checks passed`);
}

main();
