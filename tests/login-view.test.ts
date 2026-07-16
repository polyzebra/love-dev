/**
 * resolveLoginView - the ONE decision for the /login front door. Proves an
 * authenticated but incompletely-onboarded account is offered RECOVERY
 * (never bounced into the setup ladder), so the login chooser can always
 * be reached and a partial phone-first account is never trapped. Run with:
 *   npx tsx tests/login-view.test.ts
 *
 * Pure/unit: no DB, no network. Also source-scans proxy.ts to prove the
 * edge reverse-gate that caused the trap is gone.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { LoginView } from "../src/lib/auth/gate";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main() {
  const { resolveLoginView, RESTRICTED_ACCOUNT_ROUTE, PLACEHOLDER_EMAIL_SUFFIX } =
    await import("../src/lib/auth/gate");
  const { CURRENT_VERSIONS } = await import("../src/lib/auth/consent");

  // A fully set-up account; individual cases override just what they test.
  const base = {
    status: "ACTIVE",
    bannedAt: null as Date | null,
    email: "real@example.com",
    emailVerified: new Date() as Date | null,
    phoneVerifiedAt: new Date() as Date | null,
    ageConfirmedAt: new Date() as Date | null,
    termsVersion: CURRENT_VERSIONS.terms as string | null,
    privacyVersion: CURRENT_VERSIONS.privacy as string | null,
    communityVersion: CURRENT_VERSIONS.community as string | null,
    onboardingDone: true,
  };
  const sess = (u: Partial<typeof base>) => ({ user: { ...base, ...u } });
  const recovery = (v: LoginView) => {
    assert.equal(v.kind, "recovery");
    return v as Extract<LoginView, { kind: "recovery" }>;
  };

  await check("no session -> chooser (unauthenticated always sees all methods)", () => {
    assert.deepEqual(resolveLoginView(null), { kind: "chooser" });
  });

  await check("fresh account still owing its first channel -> chooser", () => {
    const v = resolveLoginView(
      sess({ email: `x${PLACEHOLDER_EMAIL_SUFFIX}`, emailVerified: null, phoneVerifiedAt: null }),
    );
    assert.deepEqual(v, { kind: "chooser" });
  });

  await check(
    "phone-first partial (placeholder email) -> RECOVERY /auth/email [the trap case]",
    () => {
      const v = recovery(
        resolveLoginView(
          sess({
            email: `ph${PLACEHOLDER_EMAIL_SUFFIX}`,
            emailVerified: null,
            phoneVerifiedAt: new Date(),
          }),
        ),
      );
      assert.equal(v.next, "/auth/email", "gate points at the email rung");
      assert.equal(v.setupComplete, false, "not complete -> 'Continue setup' copy");
    },
  );

  await check("consent still owed -> RECOVERY /auth/legal, not complete", () => {
    const v = recovery(resolveLoginView(sess({ termsVersion: "stale-version" })));
    assert.equal(v.next, "/auth/legal");
    assert.equal(v.setupComplete, false);
  });

  await check("fully set up -> RECOVERY with setupComplete=true (Continue to Tirvea)", () => {
    const v = recovery(resolveLoginView(sess({})));
    assert.equal(v.next, "/discover");
    assert.equal(v.setupComplete, true);
  });

  await check("suspended -> redirect to the restricted status area (not recovery)", () => {
    assert.deepEqual(resolveLoginView(sess({ status: "SUSPENDED" })), {
      kind: "redirect",
      to: RESTRICTED_ACCOUNT_ROUTE,
    });
  });

  await check("banned -> redirect to the restricted status area", () => {
    assert.deepEqual(resolveLoginView(sess({ bannedAt: new Date() })), {
      kind: "redirect",
      to: RESTRICTED_ACCOUNT_ROUTE,
    });
  });

  console.log("regression guards");
  await check("proxy.ts no longer edge-redirects /login to /discover (the trap is gone)", () => {
    const src = readFileSync("src/proxy.ts", "utf8");
    assert.ok(
      !/pathname === "\/login"[\s\S]{0,200}?redirect\([\s\S]{0,80}?\/discover/.test(src),
      "the /login -> /discover reverse-gate must be removed from the proxy",
    );
  });

  await check("login page renders recovery (no unconditional redirect of sessions)", () => {
    const src = readFileSync("src/app/(auth)/login/page.tsx", "utf8");
    assert.ok(src.includes("resolveLoginView"), "login page uses the canonical decision");
    assert.ok(src.includes("LoginRecovery"), "login page renders the recovery view");
  });

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
