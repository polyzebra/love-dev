/**
 * L7.3.8 - registration governance (unit, no DB). CI fails if the deferred-
 * activation invariants regress:
 *   - a fresh app account is born PENDING (never ACTIVE)
 *   - exactly ONE activation implementation stamps registrationCompletedAt
 *   - PENDING is invisible + cannot engage; discoverable set requires onboarding
 *   - post-activation feature routes gate via requireActiveAccount
 *   - registration/setup routes do NOT (they must run before completion)
 *   - the abandoned-registration sweeper only ever touches PENDING, never ACTIVE
 *
 *   npx tsx tests/registration-governance.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}
const read = (p: string) => readFileSync(p, "utf8");

function main() {
  const identity = read("src/lib/auth/identity.ts");
  const gate = read("src/lib/auth/gate.ts");
  const api = read("src/lib/api.ts");
  const trust = read("src/lib/services/trust-safety.ts");
  const cleanup = read("src/lib/auth/cleanup.ts");
  const profile = read("src/lib/services/profile.ts");

  // Deferred activation: both registration create paths are born PENDING.
  check("fresh app-User creation is born PENDING, never ACTIVE", () => {
    const creates = identity.split("db.user.create");
    // First chunk is preamble; each create body follows a split point.
    const bodies = creates.slice(1).map((c) => c.slice(0, 400));
    assert.ok(bodies.length >= 2, "expected the two registration create paths");
    for (const b of bodies) {
      assert.ok(/status:\s*"PENDING"/.test(b), "create must set status PENDING");
      assert.ok(!/status:\s*"ACTIVE"/.test(b), "create must NOT set status ACTIVE");
    }
  });

  // Single activation implementation: only the canonical activator stamps
  // registrationCompletedAt (the write form `registrationCompletedAt: now`).
  check("exactly one activation implementation stamps registrationCompletedAt", () => {
    const srcFiles: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts") && !p.includes("/generated/"))
          srcFiles.push(p);
      }
    };
    walk("src");
    const writers = srcFiles.filter((f) => /registrationCompletedAt:\s*now\b/.test(read(f)));
    assert.deepEqual(
      writers.map((f) => f.replace(/^.*\/src\//, "src/")),
      ["src/lib/auth/identity.ts"],
      "only activateAccountIfComplete may write registrationCompletedAt",
    );
    assert.ok(/export async function activateAccountIfComplete/.test(identity));
    // The terminal rung delegates to that one activator (no bespoke activation).
    assert.ok(/activateAccountIfComplete\(/.test(profile), "onboarding delegates to the activator");
  });

  // PENDING is invisible + cannot engage; discoverable requires onboarding.
  check(
    "PENDING excluded from discoverable/engageable; discoverable requires onboardingDone",
    () => {
      // DISCOVERABLE_STATUSES literal must not contain PENDING.
      const disc = trust.slice(
        trust.indexOf("DISCOVERABLE_STATUSES"),
        trust.indexOf("RESTRICTED_STATUSES"),
      );
      assert.ok(!/PENDING/.test(disc), "PENDING must not be discoverable");
      assert.ok(
        /onboardingDone:\s*true/.test(trust),
        "DISCOVERABLE_USER_WHERE must require onboardingDone",
      );
      const engage = trust.slice(
        trust.indexOf("function canEngage"),
        trust.indexOf("function canEngage") + 160,
      );
      assert.ok(!/PENDING/.test(engage), "PENDING must not be able to engage");
    },
  );

  // requireActiveAccount uses the canonical resolver.
  check("requireActiveAccount gates on the canonical resolver (registrationComplete)", () => {
    assert.ok(/export async function requireActiveAccount/.test(api));
    const body = api.slice(api.indexOf("function requireActiveAccount"));
    assert.ok(/registrationComplete\(user\)/.test(body), "must call registrationComplete");
    assert.ok(/registration_incomplete/.test(api), "must return registration_incomplete");
    // The resolver derives state from the ONE ladder (authNextStep).
    assert.ok(/authNextStep\(user, phoneEnabled\)\s*===\s*"\/discover"/.test(gate));
  });

  // Post-activation feature routes gate via requireActiveAccount.
  check("post-activation feature routes use requireActiveAccount", () => {
    const feature = [
      "src/app/api/discover/route.ts",
      "src/app/api/swipes/route.ts",
      "src/app/api/matches/route.ts",
      "src/app/api/billing/checkout/route.ts",
      "src/app/api/conversations/route.ts",
      "src/app/api/first-messages/route.ts",
      "src/app/api/notifications/read/route.ts",
      "src/app/api/presence/heartbeat/route.ts",
    ];
    for (const f of feature) {
      const s = read(f);
      // L8.3.4F: Discovery routes gate via requireDiscoveryViewer, the canonical
      // wrapper that composes requireActiveAccount + the capability resolver.
      assert.ok(
        /requireActiveAccount\(/.test(s) || /requireDiscoveryViewer\(/.test(s),
        `${f} must use requireActiveAccount (or the canonical requireDiscoveryViewer wrapper)`,
      );
      assert.ok(!/\brequireSession\(/.test(s), `${f} must not use bare requireSession`);
    }
    // The Discovery wrapper itself must still enforce the completeness gate.
    assert.match(
      read("src/lib/services/discovery-access.ts"),
      /requireActiveAccount\(/,
      "requireDiscoveryViewer must compose requireActiveAccount",
    );
  });

  // Registration/setup routes must NOT require completion (would deadlock).
  check("registration/setup routes keep plain requireSession (no completion gate)", () => {
    const setup = [
      "src/app/api/onboarding/route.ts",
      "src/app/api/auth/age-confirm/route.ts",
      "src/app/api/auth/consent/route.ts",
      "src/app/api/auth/phone/verify/route.ts",
      "src/app/api/auth/registration/route.ts",
    ];
    for (const f of setup) {
      const s = read(f);
      assert.ok(!/requireActiveAccount\(/.test(s), `${f} must NOT gate on completion (deadlock)`);
      assert.ok(/requireSession\(/.test(s), `${f} must use requireSession`);
    }
  });

  // Abandoned-registration sweeper only touches PENDING, guards billing.
  check("cleanup sweeps only PENDING, never ACTIVE, and spares subscribers", () => {
    const fn = cleanup.slice(cleanup.indexOf("cleanupAbandonedRegistrations"));
    assert.ok(/status:\s*"PENDING"/.test(fn), "candidate query filters PENDING");
    assert.ok(!/status:\s*"ACTIVE"/.test(fn), "never targets ACTIVE");
    assert.ok(/u\.subscription\s*\|\|\s*u\._count\.payments/.test(fn), "skips subscribers/payers");
    // deleteMany re-asserts the guard (no race with a just-completed account).
    const del = fn.slice(fn.indexOf("deleteMany"));
    assert.ok(/status:\s*"PENDING"/.test(del) && /registrationCompletedAt:\s*null/.test(del));
  });

  // ---- L7.3.9 immutability invariants ----

  // The DB makes impossible activation states impossible (CHECK constraints).
  check("a migration installs the ACTIVE⇒registrationCompletedAt DB constraint", () => {
    const dir = "prisma/migrations";
    const sql = readdirSync(dir)
      .map((e) => {
        try {
          return read(join(dir, e, "migration.sql"));
        } catch {
          return "";
        }
      })
      .join("\n");
    assert.ok(
      /CHECK\s*\(\s*"?status"?\s*<>\s*'ACTIVE'\s*OR\s*"registrationCompletedAt"\s*IS NOT NULL/i.test(
        sql,
      ),
      "ACTIVE requires registrationCompletedAt (DB CHECK)",
    );
    assert.ok(
      /User_active_requires_completed_registration/.test(sql),
      "named activation-integrity constraint must exist",
    );
  });

  // The activator throws (never silently activates against the rules).
  check("activator enforces the contract (RegistrationStateViolation, force+audit)", () => {
    assert.ok(/export class RegistrationStateViolation/.test(identity));
    const fn = identity.slice(identity.indexOf("export async function activateAccountIfComplete"));
    assert.ok(/SUSPENDED|BANNED|bannedAt/.test(fn), "refuses suspended/banned");
    assert.ok(
      /force activation requires an actor and a reason/.test(fn),
      "force needs actor+reason",
    );
    assert.ok(/recordAuthEvent\(/.test(fn), "every activation is audited");
    assert.ok(/previousState/.test(fn) && /newState/.test(fn), "audit records prev/new state");
  });

  // Force-activate is Super-Admin-only, reason-gated, and routes through the
  // ONE activator - no raw 'set ACTIVE' / 'set registration complete' control.
  check("admin force-activate is super-admin + reason + canonical activator", () => {
    const route = read("src/app/api/admin/users/[id]/force-activate/route.ts");
    assert.ok(/requirePermission\("users:activate"\)/.test(route), "super-admin permission");
    assert.ok(/activateAccountIfComplete\(/.test(route), "delegates to the one activator");
    assert.ok(/reason:\s*z\.string/.test(route), "reason is mandatory");
    const rbac = read("src/lib/rbac.ts");
    assert.match(
      rbac,
      /"users:activate":\s*\["SUPER_ADMIN"\]/,
      "users:activate is SUPER_ADMIN only",
    );
    // No admin path may set ACTIVE on an incomplete account.
    const admin = read("src/lib/services/user-admin.ts");
    const setStatus = admin.slice(admin.indexOf("export async function setUserStatus"));
    assert.ok(
      /registrationCompletedAt\s*\?\s*"ACTIVE"\s*:\s*"PENDING"/.test(setStatus),
      "setUserStatus cannot force ACTIVE on an incomplete registration",
    );
  });

  // Every ACTIVE-restoring lifecycle path is constraint-safe.
  check("unban / restriction-lift restore PENDING when not completed", () => {
    const admin = read("src/lib/services/user-admin.ts");
    const unban = admin.slice(admin.indexOf("export async function unbanUser"));
    assert.ok(/registrationCompletedAt\s*\?\s*"ACTIVE"\s*:\s*"PENDING"/.test(unban), "unban safe");
    assert.ok(
      /registrationCompletedAt\s*\?\s*"ACTIVE"\s*:\s*"PENDING"/.test(trust),
      "restriction-lift safe",
    );
  });

  // Realtime private channels exclude PENDING (RLS membership helper).
  check("realtime chat membership excludes PENDING (RLS helper)", () => {
    const mig = read("prisma/migrations/20260713150000_realtime_chat_authorization/migration.sql");
    assert.ok(/status IN \('ACTIVE', 'SHADOW_BANNED'\)/.test(mig), "PENDING not chat-capable");
    assert.ok(!/'PENDING'/.test(mig), "PENDING never granted realtime membership");
  });

  console.log(`\n${passed} checks passed`);
}

main();
