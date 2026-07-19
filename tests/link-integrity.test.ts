/**
 * Link Integrity governance (L7.1, Phase P/Q). CI FAILS if any internal
 * navigation target stops resolving to a real route - i.e. a broken href, a
 * deleted/renamed route still referenced, or a wrong slug. Pure source-contract
 * (no DB, no server): it builds the App-Router page/API route graph from the
 * filesystem and cross-checks every static path literal used in a navigation
 * source (href / <Link> / router.push|replace / redirect / NextResponse.redirect
 * / fetch to /api).
 *   npx tsx tests/link-integrity.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (p.includes("/generated/")) continue;
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}
const read = (p: string) => readFileSync(p, "utf8");

/** App-Router page routes -> matcher regexes (strip (groups); [x] -> [^/]+). */
function pageRouteMatchers(files: string[]): RegExp[] {
  const routes = files
    .filter((f) => /^src\/app\/.*\/page\.tsx$/.test(f) || f === "src/app/page.tsx")
    .map((f) => {
      const r = f
        .replace(/^src\/app/, "")
        .replace(/\/page\.tsx$/, "")
        .replace(/\/\([^)]+\)/g, "");
      return r === "" ? "/" : r;
    });
  return routes.map(
    (r) => new RegExp("^" + r.replace(/\[[^\]]+\]/g, "[^/]+").replace(/\//g, "\\/") + "$"),
  );
}
function apiRouteMatchers(files: string[]): RegExp[] {
  const routes = files
    .filter((f) => /^src\/app\/api\/.*\/route\.ts$/.test(f))
    .map((f) => f.replace(/^src\/app/, "").replace(/\/route\.ts$/, ""));
  return routes.map(
    (r) => new RegExp("^" + r.replace(/\[[^\]]+\]/g, "[^/]+").replace(/\//g, "\\/") + "$"),
  );
}

// Non-page targets that legitimately are not App-Router pages.
const KNOWN_NONPAGE = new Set(["/", "/sitemap.xml", "/robots.txt", "/manifest.webmanifest"]);

function main() {
  const files = walk("src");
  const pageRes = pageRouteMatchers(files);
  const apiRes = apiRouteMatchers(files);
  const isPage = (p: string) => KNOWN_NONPAGE.has(p) || pageRes.some((re) => re.test(p));
  const isApi = (p: string) => apiRes.some((re) => re.test(p));

  // Extract static internal PAGE path literals from nav sources.
  const NAV =
    /(?:href=|router\.(?:push|replace|prefetch)\(|(?:^|[^.\w])redirect\(|permanentRedirect\(|NextResponse\.redirect\()\s*["'`](\/[a-zA-Z0-9/_.#?=-]*)["'`]/g;

  const brokenPages: string[] = [];
  const brokenApis: string[] = [];

  for (const f of files) {
    if (f.includes("/generated/")) continue;
    const src = read(f);

    // Page navigation targets.
    for (const m of src.matchAll(NAV)) {
      const raw = m[1];
      if (raw.includes("${") || raw.includes("`")) continue; // template - dynamic
      const p = (raw.split("#")[0].split("?")[0].replace(/\/$/, "") || "/") as string;
      if (p.startsWith("/api/")) continue;
      if (!isPage(p)) brokenPages.push(`${f.replace(/^src\//, "")}: ${p}`);
    }

    // Static /api fetch targets (dynamic ${...} ones are skipped).
    for (const m of src.matchAll(/fetch\(\s*["'](\/api\/[a-zA-Z0-9/_.-]+)["']/g)) {
      const p = m[1].split("?")[0].replace(/\/$/, "");
      if (!isApi(p)) brokenApis.push(`${f.replace(/^src\//, "")}: ${p}`);
    }
  }

  check("every internal PAGE link resolves to a real App-Router route", () => {
    assert.deepEqual(brokenPages, [], "broken/renamed page links");
  });

  check("every static /api fetch resolves to a real route handler", () => {
    assert.deepEqual(brokenApis, [], "broken API references");
  });

  // The Legal Navigation Contract stays canonical (defense-in-depth with
  // tests/legal-navigation-governance.test.ts).
  check("no hardcoded /legal URL outside the legal module", () => {
    const offenders = files.filter((f) => {
      if (
        f.startsWith("src/lib/legal/") ||
        f.startsWith("src/components/legal/") ||
        f.startsWith("src/app/(marketing)/legal/") ||
        f === "src/app/sitemap.ts"
      )
        return false;
      return /["'`]\/legal(\/[a-z-]+)?["'`]/.test(
        read(f)
          .split("\n")
          .filter((l) => !/^\s*(\*|\/\/)/.test(l))
          .join("\n"),
      );
    });
    assert.deepEqual(offenders, [], "use LEGAL_ROUTES/LEGAL_HUB");
  });

  console.log(`\n${passed} checks passed`);
}

main();
