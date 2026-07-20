/**
 * L8.1 - Trust ENTRY GATE (unit, no DB). Proves that AWS Face Liveness becomes
 * the FINAL registration rung ONLY when the gate is active, that the default
 * (dormant) path is byte-identical to before the rung existed (FAIL OPEN so a
 * dormant provider can never lock users out), and that an already-activated
 * account is NEVER retro-locked.
 *
 *   npx tsx tests/liveness-entry-gate.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  authNextStep,
  registrationComplete,
  registrationLadderComplete,
  resolveRegistrationState,
  LIVENESS_STEP,
  type GateUser,
} from "@/lib/auth/gate";
import { livenessEntryGateActive } from "@/lib/services/face-rollout";
import { CURRENT_VERSIONS as V } from "@/lib/auth/consent";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

/** A fully-laddered user (onboarding done) with NO liveness yet. */
function mk(o: Partial<GateUser> = {}): GateUser {
  return {
    status: "PENDING",
    bannedAt: null,
    email: "a@b.com",
    emailVerified: new Date(),
    phoneVerifiedAt: new Date(),
    ageConfirmedAt: new Date(),
    termsVersion: V.terms,
    privacyVersion: V.privacy,
    communityVersion: V.community,
    onboardingDone: true,
    registrationCompletedAt: null,
    livenessPassedAt: null,
    ...o,
  };
}
const ON = true; // phone verification enabled
const OFF = false; // liveness gate INACTIVE (the default/dormant path)
const GATE = true; // liveness gate ACTIVE

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, val] of Object.entries(vars)) {
    if (val === undefined) delete process.env[k];
    else process.env[k] = val;
  }
  try {
    fn();
  } finally {
    for (const [k, val] of Object.entries(prev)) {
      if (val === undefined) delete process.env[k];
      else process.env[k] = val;
    }
  }
}

function main() {
  // ---- FAIL OPEN: gate inactive => byte-identical to the pre-rung ladder ----
  check("gate INACTIVE: a fully-laddered user (no liveness) still reaches /discover", () => {
    assert.equal(authNextStep(mk(), ON, OFF), "/discover");
    assert.equal(registrationComplete(mk(), ON, OFF), true);
    assert.equal(registrationLadderComplete(mk(), ON, OFF), true);
    assert.equal(resolveRegistrationState(mk(), ON, OFF), "ACTIVE");
  });

  check("gate INACTIVE: livenessPassedAt is irrelevant at every ladder position", () => {
    // Walk back up the ladder; the liveness field must never change the answer.
    assert.equal(authNextStep(mk({ onboardingDone: false }), ON, OFF), "/onboarding");
    assert.equal(authNextStep(mk({ ageConfirmedAt: null }), ON, OFF), "/auth/age");
    assert.equal(authNextStep(mk({ phoneVerifiedAt: null }), ON, OFF), "/auth/phone");
  });

  // ---- GATE ACTIVE: liveness is the FINAL rung -----------------------------
  check("gate ACTIVE: laddered user WITHOUT liveness is sent to the liveness step", () => {
    assert.equal(authNextStep(mk(), ON, GATE), LIVENESS_STEP);
    assert.equal(registrationLadderComplete(mk(), ON, GATE), false);
    assert.equal(registrationComplete(mk(), ON, GATE), false); // no stamp, no liveness
    assert.equal(resolveRegistrationState(mk(), ON, GATE), "LIVENESS_PENDING");
  });

  check("gate ACTIVE: liveness PASS unlocks /discover and completion", () => {
    const u = mk({ livenessPassedAt: new Date() });
    assert.equal(authNextStep(u, ON, GATE), "/discover");
    assert.equal(registrationComplete(u, ON, GATE), true);
    assert.equal(resolveRegistrationState(u, ON, GATE), "ACTIVE");
  });

  check("gate ACTIVE: liveness is LAST - earlier rungs still take priority", () => {
    // Missing an earlier rung must route there, never jump to liveness.
    assert.equal(authNextStep(mk({ onboardingDone: false }), ON, GATE), "/onboarding");
    assert.equal(authNextStep(mk({ ageConfirmedAt: null }), ON, GATE), "/auth/age");
    assert.equal(authNextStep(mk({ emailVerified: null, phoneVerifiedAt: null }), ON, GATE), "/login");
  });

  // ---- RETRO-LOCK SAFETY: existing ACTIVE users are never locked out -------
  check("CRITICAL: an already-activated account is NEVER retro-locked by the gate", () => {
    // registrationCompletedAt stamped + gate ON + no liveness -> still complete.
    const stamped = mk({ registrationCompletedAt: new Date(), livenessPassedAt: null });
    assert.equal(registrationComplete(stamped, ON, GATE), true);
    assert.equal(resolveRegistrationState(stamped, ON, GATE), "ACTIVE");
  });

  // ---- FAIL-OPEN provider guard (env-driven livenessEntryGateActive) -------
  check("livenessEntryGateActive: OFF unless flag set AND a provider configured", () => {
    withEnv({ LIVENESS_ENTRY_GATE: undefined, FACE_MATCH_PROVIDER: undefined }, () => {
      assert.equal(livenessEntryGateActive(), false, "unset => inactive");
    });
    withEnv({ LIVENESS_ENTRY_GATE: "1", FACE_MATCH_PROVIDER: undefined }, () => {
      assert.equal(livenessEntryGateActive(), false, "flag on but provider dormant => inactive (FAIL OPEN)");
    });
    withEnv({ LIVENESS_ENTRY_GATE: "1", FACE_MATCH_PROVIDER: "off" }, () => {
      assert.equal(livenessEntryGateActive(), false, "provider 'off' => inactive");
    });
    withEnv({ LIVENESS_ENTRY_GATE: "1", FACE_MATCH_PROVIDER: "rekognition" }, () => {
      assert.equal(livenessEntryGateActive(), true, "flag on + provider => ACTIVE");
    });
    withEnv(
      { LIVENESS_ENTRY_GATE: "1", FACE_MATCH_PROVIDER: "rekognition", FACE_EMERGENCY_DISABLE: "1" },
      () => {
        assert.equal(livenessEntryGateActive(), false, "kill switch forces inactive");
      },
    );
  });

  // ---- GOVERNANCE: one resolver, one activator -----------------------------
  const read = (p: string) => readFileSync(p, "utf8");
  check("the liveness rung lives ONLY in the canonical ladder (gate.ts)", () => {
    const gate = read("src/lib/auth/gate.ts");
    // The rung: livenessRequired && !livenessPassedAt -> LIVENESS_STEP.
    assert.match(gate, /livenessRequired && !user\.livenessPassedAt/, "rung defined in gate.ts");
    // No OTHER file may re-derive interaction eligibility from livenessPassedAt.
    const offenders = ["src/lib/api.ts", "src/lib/auth/require-user.ts"].filter((f) =>
      /livenessPassedAt/.test(read(f)),
    );
    assert.deepEqual(offenders, [], "interaction guards delegate to the ladder, never re-check liveness");
  });

  check("liveness PASS delegates to the ONE activator (activateAccountIfComplete)", () => {
    const fl = read("src/lib/services/face-liveness.ts");
    assert.match(fl, /livenessPassedAt: new Date\(\)/, "PASS stamps livenessPassedAt");
    assert.match(fl, /activateAccountIfComplete\(userId\)/, "PASS calls the canonical activator");
  });

  // ---- L8.1.1 entry PAGE governance ----------------------------------------
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (p.includes("/generated/")) continue;
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
    }
    return out;
  };

  check("the /auth/liveness page exists and derives access from the canonical resolver", () => {
    // Closes the previously-dangling LIVENESS_STEP redirect target.
    const page = read("src/app/(auth)/auth/liveness/page.tsx");
    assert.match(page, /requireUser\(\{ allow: LIVENESS_STEP \}\)/, "gates via requireUser + allow");
    assert.match(page, /authNextStep\(user\)/, "derives from the ONE ladder, not a copy");
    assert.match(page, /redirect\("\/discover"\)/, "sends already-complete users onward");
    // Phase governance: a route must NEVER write ACTIVE / stamp completion.
    assert.doesNotMatch(page, /status:\s*"ACTIVE"/, "page never writes ACTIVE directly");
    assert.doesNotMatch(page, /registrationCompletedAt:/, "page never stamps completion");
  });

  check("the entry CTA performs the REAL action (mounts LivenessCapture), never a dead nav", () => {
    const entry = read("src/components/auth/LivenessEntryStep.tsx");
    assert.match(entry, /<LivenessCapture/, "mounts the real AWS liveness flow");
    assert.match(entry, /startLabel="Start Face Verification"/, "first-time enrolment label");
    assert.doesNotMatch(entry, /Verify Photos/, "never the misleading gallery-nav CTA");
  });

  check("GOVERNANCE: exactly ONE runtime writer of livenessPassedAt", () => {
    const writers = walk("src").filter((f) => /livenessPassedAt:\s*new Date\(\)/.test(read(f)));
    assert.deepEqual(writers, ["src/lib/services/face-liveness.ts"], "one writer only");
  });

  check("GOVERNANCE: no page/route under src/app writes livenessPassedAt", () => {
    // The registration PENDING->ACTIVE activation invariant (one activator) is
    // covered by registration-governance; here we guard only that no app route
    // stamps the liveness signal directly (it belongs to the PASS handler).
    const offenders = walk("src/app").filter((f) =>
      /livenessPassedAt:\s*new Date\(\)/.test(read(f)),
    );
    assert.deepEqual(offenders, [], "liveness stamp stays in the ONE writer");
  });

  check("the auth session carries livenessPassedAt so the gate resolves after PASS", () => {
    const authSrc = read("src/lib/auth.ts");
    assert.match(authSrc, /livenessPassedAt: appUser\.livenessPassedAt/, "session includes it");
    assert.match(authSrc, /livenessPassedAt: Date \| null/, "and it is typed on AppSession.user");
  });

  console.log(`\n${passed} checks passed`);
}

main();
