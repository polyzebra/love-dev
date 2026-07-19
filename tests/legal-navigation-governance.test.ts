/**
 * Legal Navigation Contract governance (Phase K) + registry consistency.
 * CI FAILS if a future change forks legal navigation. There must FOREVER remain:
 *   - ONE canonical route registry (LEGAL_ROUTES, src/lib/legal/routes.ts);
 *   - ONE LegalLink component (src/components/shared/legal-link.tsx);
 *   - NO hardcoded "/legal/..." URLs outside the legal module (use LEGAL_ROUTES);
 *   - NO JS navigation (router.push/window.location) to legal docs - anchors only;
 *   - onboarding/auth never links to the authed /settings legal mirror.
 * Pure source-contract + a runtime consistency check (no DB, no env).
 *   npx tsx tests/legal-navigation-governance.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const read = (p: string) => readFileSync(p, "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (p.includes("/generated/")) continue;
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

function stripComments(src: string): string {
  return src
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

/** The canonical legal module - the ONLY place a raw "/legal" string may live. */
function inLegalModule(f: string): boolean {
  return (
    f.startsWith("src/lib/legal/") ||
    f.startsWith("src/components/legal/") ||
    f.startsWith("src/app/(marketing)/legal/") ||
    f === "src/app/sitemap.ts" // enumerates routes from the registry
  );
}

async function main() {
  const files = walk("src");

  // ---- ONE registry, ONE component -----------------------------------------
  await check("exactly ONE LEGAL_ROUTES registry and ONE LegalLink component", () => {
    const routes = files.filter((f) => /export const LEGAL_ROUTES\b/.test(read(f)));
    assert.deepEqual(routes, ["src/lib/legal/routes.ts"], "one LEGAL_ROUTES registry");
    const link = files.filter((f) => /export function LegalLink\b/.test(read(f)));
    assert.deepEqual(link, ["src/components/shared/legal-link.tsx"], "one LegalLink component");
  });

  // ---- NO hardcoded legal URL outside the legal module ---------------------
  await check(
    "no hardcoded /legal URL outside the legal module (use LEGAL_ROUTES / LEGAL_HUB)",
    () => {
      const re = /"\/legal(\/[a-z-]+)?"/;
      const offenders = files.filter((f) => !inLegalModule(f) && re.test(stripComments(read(f))));
      assert.deepEqual(offenders, [], "import LEGAL_ROUTES/LEGAL_HUB; never hardcode a /legal URL");
    },
  );

  // ---- Legal navigation is anchors, never JS navigation (Phase D) ----------
  await check("no router.push / window.location / history navigation to a legal route", () => {
    const re =
      /(router\.(push|replace)|window\.location\.(assign|href)|history\.(push|replace)State)\([^)]*\/legal/;
    const offenders = files.filter((f) => re.test(stripComments(read(f))));
    assert.deepEqual(offenders, [], "legal links MUST be <a>/<Link href>, never JS navigation");
  });

  // ---- Onboarding/auth must use the PUBLIC legal route, not the authed one --
  await check("onboarding/auth never links to the authed /settings/community-guidelines", () => {
    const authFiles = files.filter(
      (f) => f.startsWith("src/components/auth/") || f.startsWith("src/app/(auth)/"),
    );
    const offenders = authFiles.filter((f) => /\/settings\/community-guidelines/.test(read(f)));
    assert.deepEqual(offenders, [], "auth/onboarding must use LEGAL_ROUTES.communityGuidelines");
  });

  // ---- LEGAL_ROUTES must not drift from the registry (no phantom routes) ----
  await check("every LEGAL_ROUTES value is a real registry legal route (no drift)", async () => {
    const { LEGAL_ROUTES, isLegalRoute } = await import("../src/lib/legal/routes");
    const { LEGAL_DOCS } = await import("../src/lib/legal/registry");
    const registryPaths = new Set(LEGAL_DOCS.map((d) => d.path));
    for (const route of Object.values(LEGAL_ROUTES)) {
      assert.ok(isLegalRoute(route), `${route} is a canonical legal route`);
      assert.ok(registryPaths.has(route), `${route} exists in LEGAL_DOCS (no phantom route)`);
    }
    // Every markdown-master doc slug is reachable via LEGAL_ROUTES.
    const { LEGAL_DOC_SLUGS } = await import("../src/lib/legal/doc-slugs");
    const routeValues = new Set<string>(Object.values(LEGAL_ROUTES));
    for (const slug of LEGAL_DOC_SLUGS) {
      assert.ok(routeValues.has(`/legal/${slug}`), `LEGAL_ROUTES covers /legal/${slug}`);
    }
  });

  console.log(`\n${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
