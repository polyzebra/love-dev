/**
 * L8.3.4F Discovery governance. Fails CI if any Discovery surface forks the ONE
 * authorization contract: viewer access must go through requireDiscoveryViewer
 * (the capability resolver), candidate eligibility through the ONE query adapter
 * (DISCOVERABLE_USER_WHERE), and the discoverable-status array must live in
 * exactly one place. Source-contract; no DB. Run:
 *   npx tsx tests/discovery-governance.test.ts
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
const read = (p: string) => readFileSync(p, "utf8");
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (p.includes("/generated/")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const ADAPTER = "src/lib/services/trust-safety.ts";
const VIEWER_GATE = "src/lib/services/discovery-access.ts";

// The Discovery-class read routes that must gate the VIEWER canonically.
const DISCOVERY_ROUTES = [
  "src/app/api/discover/route.ts",
  "src/app/api/explore/categories/route.ts",
  "src/app/api/explore/categories/[slug]/route.ts",
  "src/app/api/explore/profile/[userId]/route.ts",
];

function main() {
  // ---- Phase B/J: viewer authorization is canonical --------------------------
  check("every Discovery route gates the viewer via requireDiscoveryViewer", () => {
    for (const r of DISCOVERY_ROUTES) {
      const s = read(r);
      assert.match(s, /requireDiscoveryViewer\(\)/, `${r} must call requireDiscoveryViewer`);
      // No route may fall back to the bare completeness gate for Discovery access.
      assert.doesNotMatch(s, /\brequireActiveAccount\s*\(/, `${r} must not use bare requireActiveAccount`);
    }
  });

  check("the viewer gate delegates to the capability resolver (not a status check)", () => {
    const s = read(VIEWER_GATE);
    assert.match(s, /resolveDatingEntry\(/, "must resolve canEnterDating via the resolver");
    assert.doesNotMatch(s, /status\s*===\s*"ACTIVE"/, "no direct status === ACTIVE");
  });

  // ---- Phase C/E: ONE candidate query adapter -------------------------------
  check("the discoverable-status array lives ONLY in the canonical adapter", () => {
    const re = /\[[^\]]*"ACTIVE"[^\]]*"LIMITED"[^\]]*"PHOTO_REVIEW_REQUIRED"[^\]]*\]/;
    const offenders = walk("src")
      .filter((f) => f.replace(/\\/g, "/") !== ADAPTER)
      .filter((f) => re.test(read(f)));
    assert.deepEqual(offenders, [], "no route/service may rebuild the discoverable-status list");
  });

  check("candidate feeds import the ONE query adapter (DISCOVERABLE_USER_WHERE)", () => {
    for (const f of ["src/lib/services/discovery.ts", "src/lib/services/explore.ts"]) {
      assert.match(read(f), /DISCOVERABLE_USER_WHERE/, `${f} must use the canonical adapter`);
    }
  });

  check("no Discovery route rebuilds a candidate WHERE (status/onboarding/visibility)", () => {
    for (const r of DISCOVERY_ROUTES) {
      const s = read(r);
      assert.doesNotMatch(s, /onboardingDone\s*:/, `${r} must not rebuild onboarding filter`);
      assert.doesNotMatch(s, /status\s*:\s*\{\s*in\s*:/, `${r} must not rebuild status filter`);
    }
  });

  // ---- Phase D: viewer vs candidate are distinct ----------------------------
  check("viewer gate uses canEnterDating; candidate adapter is separate (not conflated)", () => {
    // Strip comments - the docstring legitimately explains the distinction.
    const code = read(VIEWER_GATE)
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");
    // The viewer gate must NOT gate browse on APPEARANCE (would break shadow-ban
    // + hidden-user browsing) - it uses canEnterDating.
    assert.doesNotMatch(code, /canAppearInDiscovery/, "viewer gate must not use canAppearInDiscovery");
    assert.match(code, /resolveDatingEntry/, "viewer gate uses the entry decision");
  });

  // ---- L8.3.4F.1: the Discovery PAGE gates symmetrically --------------------
  check("discover/page.tsx uses requireDiscoveryViewer, never bare requireActiveAccount", () => {
    const page = read("src/app/(app)/discover/page.tsx");
    assert.match(page, /requireDiscoveryViewer\(\)/, "page must call the canonical viewer gate");
    assert.doesNotMatch(page, /requireActiveAccount/, "page must not import/call requireActiveAccount");
  });

  check("discover/page.tsx never inspects account status or capability fields itself", () => {
    const code = read("src/app/(app)/discover/page.tsx")
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");
    assert.doesNotMatch(code, /\.status\b/, "no direct account-status inspection");
    assert.doesNotMatch(code, /resolveAccountCapabilities|canEnterDating|canAppearInDiscovery/, "no inline capability logic");
  });

  console.log(`\n${passed} checks passed`);
}

main();
