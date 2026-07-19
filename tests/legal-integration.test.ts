/**
 * Legal Centre integration consistency (L2.9).
 *
 * Fail-fast source-contract test that keeps the registry, routes, loader, hub,
 * and footer in agreement. Pure file scan: no DB, no env, no server imports
 * (parses source text), so it runs in the UNIT lane.
 *
 * Fails when:
 *   - a master exists but is not mapped to the loader
 *   - a registry entry has no route
 *   - a loader slug has no registry entry (or its master file is missing)
 *   - a registry (non-external) path has no route (covers footer, which is
 *     registry-derived)
 *   - a related-policy slug is invalid (unknown target, self-reference, dup)
 *   - a placeholder page is marked published, or any entry is published while
 *     not master-backed and wired
 *   - a master-backed route still contains hardcoded legal prose
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
let passed = 0;
const ok = (name: string) => {
  passed += 1;
  console.log(`  ok - ${name}`);
};
const LEGAL_DIR = "src/app/(marketing)/legal";

// ---- parse registry -------------------------------------------------------
type Entry = {
  path: string;
  slug: string;
  category: string;
  status: string;
  version: string;
  related: string[];
};
function parseRegistry(): Entry[] {
  const reg = read("src/lib/legal/registry.ts");
  const marks: { path: string; start: number }[] = [];
  const re = /path:\s*"(\/legal\/[a-z-]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(reg))) marks.push({ path: m[1], start: m.index });
  return marks.map((mk, i) => {
    const seg = reg.slice(mk.start, i + 1 < marks.length ? marks[i + 1].start : reg.length);
    const category = /category:\s*"([^"]+)"/.exec(seg)?.[1] ?? "";
    const status = /status:\s*"([^"]+)"/.exec(seg)?.[1] ?? "";
    const version = /version:\s*"([^"]+)"/.exec(seg)?.[1] ?? "";
    const relBlock = /related:\s*\[([\s\S]*?)\]/.exec(seg)?.[1] ?? "";
    const related = [...relBlock.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    return { path: mk.path, slug: mk.path.replace("/legal/", ""), category, status, version, related };
  });
}

// ---- parse loader + doc-slugs + masters -----------------------------------
function parseLoaderMap(): Record<string, string> {
  const loader = read("src/lib/legal/loader.ts");
  const block = /LEGAL_DOC_FILES[\s\S]*?\{([\s\S]*?)\};/.exec(loader)?.[1] ?? "";
  const map: Record<string, string> = {};
  for (const mm of block.matchAll(/["']?([a-z-]+)["']?\s*:\s*"([^"]+\.md)"/g)) map[mm[1]] = mm[2];
  return map;
}
function parseWiredSlugs(): string[] {
  const ds = read("src/lib/legal/doc-slugs.ts");
  const block = /LEGAL_DOC_SLUGS\s*=\s*\[([\s\S]*?)\]/.exec(ds)?.[1] ?? "";
  return [...block.matchAll(/"([a-z-]+)"/g)].map((x) => x[1]);
}
function mastersBySlug(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(path.join(ROOT, "docs"))) {
    if (!name.endsWith(".md")) continue;
    const t = read(`docs/${name}`);
    if (!t.startsWith("---")) continue;
    const fm = t.split("\n---", 2)[0];
    const slug = /^slug:\s*(\S+)/m.exec(fm)?.[1];
    if (slug) out[slug] = name;
  }
  return out;
}

const entries = parseRegistry();
const bySlug = new Map(entries.map((e) => [e.slug, e]));
const loaderMap = parseLoaderMap();
const wired = new Set(parseWiredSlugs());
const masters = mastersBySlug();
const NON_REGISTRY_OK = new Set(["/safety", "/about"]);

console.log(`Legal integration: ${entries.length} registry entries, ${Object.keys(loaderMap).length} loader mappings, ${Object.keys(masters).length} masters`);

// 1. registry count
// L4.3: System Status was de-listed (placeholder linking to a dead domain);
// its route is retained as a redirect but has no registry entry.
assert.equal(entries.length, 26, `expected 26 registry entries, got ${entries.length}`);
ok("registry has 26 entries");

// 2. every registry entry has a route
for (const e of entries) {
  assert.ok(existsSync(path.join(ROOT, LEGAL_DIR, e.slug, "page.tsx")), `no route for ${e.path}`);
}
ok("every registry entry has a route");

// 3. every master is mapped to the loader
for (const [slug] of Object.entries(masters)) {
  // only policy masters (those whose slug is a registry entry) must be mapped
  if (bySlug.has(slug)) {
    assert.ok(loaderMap[slug], `master exists for "${slug}" but is not mapped in the loader`);
  }
}
ok("every policy master is mapped in the loader");

// 4. every loader slug has a registry entry, a wired slug, and an existing master file
for (const [slug, file] of Object.entries(loaderMap)) {
  assert.ok(bySlug.has(slug), `loader slug "${slug}" has no registry entry`);
  assert.ok(wired.has(slug), `loader slug "${slug}" is not in LEGAL_DOC_SLUGS`);
  assert.ok(existsSync(path.join(ROOT, "docs", file)), `loader master file missing: docs/${file}`);
}
ok("loader slugs map to registry + wired slug + existing master file");

// 5. related graph: valid target, no self-reference, no duplicate
for (const e of entries) {
  const seen = new Set<string>();
  for (const r of e.related) {
    assert.ok(!seen.has(r), `duplicate related "${r}" in ${e.path}`);
    seen.add(r);
    assert.notEqual(r, e.path, `self-reference in ${e.path}`);
    const isLegal = r.startsWith("/legal/");
    if (isLegal) assert.ok(bySlug.has(r.replace("/legal/", "")), `invalid related slug "${r}" in ${e.path}`);
    else assert.ok(NON_REGISTRY_OK.has(r), `unknown related target "${r}" in ${e.path}`);
  }
}
ok("related graph: all targets valid, no self-reference, no duplicates");

// 6. status honesty: no placeholder or non-wired page marked published
for (const e of entries) {
  const page = read(`${LEGAL_DIR}/${e.slug}/page.tsx`);
  const isPlaceholder = /being finalised/i.test(page);
  const isWiredMaster = wired.has(e.slug) && page.includes("LegalDocument");
  if (e.status === "published") {
    assert.ok(!isPlaceholder, `placeholder marked published: ${e.path}`);
    assert.ok(isWiredMaster, `published but not a wired master: ${e.path}`);
  }
}
ok("no placeholder or non-wired page is marked published");

// 7. master-backed routes are thin wrappers with no hardcoded legal prose
for (const slug of wired) {
  const page = read(`${LEGAL_DIR}/${slug}/page.tsx`);
  assert.ok(page.includes("LegalDocument"), `wired slug "${slug}" page is not a LegalDocument wrapper`);
  assert.ok(!/<h2|<li>/.test(page), `wired slug "${slug}" page still contains hardcoded legal prose`);
}
ok("master-backed routes are thin wrappers (no hardcoded legal prose)");

// 8. Appeals specifically: wired, mapped, v1.0, links to the five required policies
const appeals = bySlug.get("appeals");
assert.ok(appeals, "appeals registry entry missing");
assert.ok(wired.has("appeals") && loaderMap["appeals"], "appeals not wired/mapped");
assert.equal(appeals!.version, "1.0", "appeals version should be 1.0");
for (const r of [
  "/legal/trust-safety",
  "/legal/account-suspension",
  "/legal/community-guidelines",
  "/legal/acceptable-use",
  "/legal/privacy",
]) {
  assert.ok(appeals!.related.includes(r), `appeals related is missing ${r}`);
}
ok("appeals wired, v1.0, and linked to the five required policies");

// 9. orphan resolution: ai-moderation and copyright have inbound links
const inbound = new Map<string, number>();
for (const e of entries) for (const r of e.related) inbound.set(r, (inbound.get(r) ?? 0) + 1);
for (const slug of ["ai-moderation", "copyright"]) {
  assert.ok((inbound.get(`/legal/${slug}`) ?? 0) > 0, `orphan not resolved: ${slug} has no inbound related`);
}
ok("previously-orphaned ai-moderation and copyright now have inbound links");

console.log(`\nlegal-integration: ${passed} checks passed`);
process.exit(0);
