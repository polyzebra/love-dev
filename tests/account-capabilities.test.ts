/**
 * Canonical account-capability resolver + machine-readable denial contract.
 * Proves ONE resolver decides what a user may do AND why not, with deterministic
 * precedence, preserving every existing restriction (incl. deliberate
 * divergences), composing - never forking - the canonical predicates. Pure; no
 * DB. Run:  npx tsx tests/account-capabilities.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolveAccountCapabilities,
  isCapabilityAllowed,
  getCapabilityDenialReasons,
  primaryDenialReason,
  CapabilityDeniedError,
  assertCapability,
  type AccountCapabilities,
  type AccountCapabilityName,
  type CapabilityFacts,
} from "../src/lib/trust/account-capabilities";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

function facts(status: string, over: Partial<CapabilityFacts> = {}): CapabilityFacts {
  return {
    status,
    registrationComplete: true,
    onboardingDone: true,
    profileVisible: true,
    badgeVisible: true,
    ...over,
  };
}

const CAP_NAMES = (
  Object.keys(resolveAccountCapabilities(facts("ACTIVE"))) as (keyof AccountCapabilities)[]
).filter((k) => k !== "accountState" && k !== "publicBadgeVisible") as AccountCapabilityName[];

const allow = (c: AccountCapabilities, n: AccountCapabilityName) => c[n].allowed;
function allDenied(c: AccountCapabilities): boolean {
  return CAP_NAMES.every((n) => c[n].allowed === false);
}
/** Every capability's PRIMARY reason equals `r`. */
function everyPrimary(c: AccountCapabilities, r: string): boolean {
  return CAP_NAMES.every((n) => c[n].denialReasons[0] === r);
}

function main() {
  // ---- shape --------------------------------------------------------------
  check("every capability is a CapabilityDecision { allowed, denialReasons }", () => {
    const c = resolveAccountCapabilities(facts("ACTIVE"));
    for (const n of CAP_NAMES) {
      assert.equal(typeof c[n].allowed, "boolean", String(n));
      assert.ok(Array.isArray(c[n].denialReasons), String(n));
      // allowed <=> no reasons (the invariant)
      assert.equal(c[n].allowed, c[n].denialReasons.length === 0, String(n));
    }
    assert.equal(typeof c.publicBadgeVisible, "boolean");
  });

  // ---- Phase V matrix -----------------------------------------------------
  check("V1 PENDING: everything denied, primary REGISTRATION_INCOMPLETE", () => {
    const c = resolveAccountCapabilities(facts("PENDING", { registrationComplete: false }));
    assert.equal(c.accountState, "PENDING_REGISTRATION");
    assert.ok(allDenied(c));
    assert.ok(everyPrimary(c, "REGISTRATION_INCOMPLETE"));
    assert.equal(c.publicBadgeVisible, false);
  });

  check("V2 face gate (inert today): when enabled, entry denied, primary FACE_VERIFICATION_REQUIRED", () => {
    const c = resolveAccountCapabilities(
      facts("ACTIVE", { faceVerificationRequired: true, faceVerified: false }),
    );
    assert.equal(c.accountState, "PENDING_FACE_VERIFICATION");
    assert.ok(allDenied(c));
    assert.ok(everyPrimary(c, "FACE_VERIFICATION_REQUIRED"));
    // Default (gate off) -> ACTIVE, not face-pending.
    assert.equal(resolveAccountCapabilities(facts("ACTIVE")).accountState, "ACTIVE");
  });

  check("V3 ACTIVE fully eligible: dating/discovery/realtime/notifs allowed", () => {
    const c = resolveAccountCapabilities(facts("ACTIVE"));
    assert.ok(allow(c, "canEnterDating"));
    assert.ok(allow(c, "canAppearInDiscovery"));
    assert.ok(allow(c, "canJoinRealtime"));
    assert.ok(allow(c, "canSendMessage"));
    assert.ok(allow(c, "canReceiveDatingNotifications"));
    assert.ok(allow(c, "canPurchasePremium"));
  });

  check("V4 ACTIVE without badge: dating capabilities stay allowed, publicBadgeVisible false", () => {
    const c = resolveAccountCapabilities(facts("ACTIVE", { badgeVisible: false }));
    assert.ok(allow(c, "canEnterDating"));
    assert.ok(allow(c, "canAppearInDiscovery"));
    assert.equal(c.publicBadgeVisible, false);
  });

  check("V7 PHOTO_REVIEW_REQUIRED: can message but NOT join realtime (divergence preserved)", () => {
    const c = resolveAccountCapabilities(facts("PHOTO_REVIEW_REQUIRED"));
    assert.equal(c.accountState, "ACTIVE");
    assert.ok(allow(c, "canSendMessage"));
    assert.ok(!allow(c, "canSendAttachment"), "uploads excluded");
    assert.ok(!allow(c, "canJoinRealtime"), "realtime join is {ACTIVE,SHADOW_BANNED}");
    assert.equal(primaryDenialReason(c, "canJoinRealtime"), "REALTIME_RESTRICTED");
  });

  check("V8 SHADOW_BANNED: joins realtime, cannot send, not discoverable; reason ACCOUNT_SHADOW_BANNED", () => {
    const c = resolveAccountCapabilities(facts("SHADOW_BANNED"));
    assert.equal(c.accountState, "LIMITED");
    assert.ok(allow(c, "canJoinRealtime"), "RLS permits SHADOW_BANNED");
    assert.ok(!allow(c, "canSendMessage"));
    assert.ok(!allow(c, "canAppearInDiscovery"));
    assert.equal(primaryDenialReason(c, "canAppearInDiscovery"), "ACCOUNT_SHADOW_BANNED");
    assert.equal(primaryDenialReason(c, "canSendMessage"), "ACCOUNT_SHADOW_BANNED");
  });

  check("V9 LIMITED: appears + views but no engagement/realtime; reason ACCOUNT_LIMITED", () => {
    const c = resolveAccountCapabilities(facts("LIMITED"));
    assert.ok(allow(c, "canAppearInDiscovery"));
    assert.ok(allow(c, "canViewMatches"));
    assert.ok(allow(c, "canSwipe"));
    assert.ok(!allow(c, "canLike"));
    assert.ok(!allow(c, "canSendMessage"));
    assert.ok(!allow(c, "canJoinRealtime"));
    assert.equal(primaryDenialReason(c, "canLike"), "ACCOUNT_LIMITED");
    assert.equal(primaryDenialReason(c, "canJoinRealtime"), "ACCOUNT_LIMITED");
  });

  check("V10 SUSPENDED / V11 DEACTIVATED / V12 DELETED: all denied, correct primary", () => {
    const s = resolveAccountCapabilities(facts("SUSPENDED"));
    assert.ok(allDenied(s) && everyPrimary(s, "ACCOUNT_SUSPENDED"));
    const d = resolveAccountCapabilities(facts("DEACTIVATED"));
    assert.ok(allDenied(d) && everyPrimary(d, "ACCOUNT_DEACTIVATED"));
    const del = resolveAccountCapabilities(facts("DELETED"));
    assert.ok(allDenied(del) && everyPrimary(del, "ACCOUNT_DELETED"));
  });

  check("V14 premium disabled: purchase denied with PREMIUM_DISABLED", () => {
    const c = resolveAccountCapabilities(facts("ACTIVE", { premiumEnabled: false }));
    assert.ok(!allow(c, "canPurchasePremium"));
    assert.ok(getCapabilityDenialReasons(c, "canPurchasePremium").includes("PREMIUM_DISABLED"));
  });

  check("V15 no entitlement: purchase ALLOWED but benefits denied NO_ACTIVE_ENTITLEMENT", () => {
    const c = resolveAccountCapabilities(facts("ACTIVE")); // entitlement defaults NONE
    assert.ok(allow(c, "canPurchasePremium"));
    assert.ok(!allow(c, "canUsePremiumBenefits"));
    assert.equal(primaryDenialReason(c, "canUsePremiumBenefits"), "NO_ACTIVE_ENTITLEMENT");
    // Active entitlement -> benefits allowed.
    assert.ok(allow(resolveAccountCapabilities(facts("ACTIVE", { entitlement: "ACTIVE" })), "canUsePremiumBenefits"));
    // Suspended never reports "purchase required" for benefits - it's suspension.
    assert.equal(
      primaryDenialReason(resolveAccountCapabilities(facts("SUSPENDED", { entitlement: "ACTIVE" })), "canUsePremiumBenefits"),
      "ACCOUNT_SUSPENDED",
    );
  });

  check("expired / revoked entitlement -> distinct benefit reasons", () => {
    assert.equal(
      primaryDenialReason(resolveAccountCapabilities(facts("ACTIVE", { entitlement: "EXPIRED" })), "canUsePremiumBenefits"),
      "ENTITLEMENT_EXPIRED",
    );
    assert.equal(
      primaryDenialReason(resolveAccountCapabilities(facts("ACTIVE", { entitlement: "REVOKED" })), "canUsePremiumBenefits"),
      "ENTITLEMENT_REVOKED",
    );
  });

  check("V16 realtime disabled: realtime denied, other dating capabilities unchanged", () => {
    const c = resolveAccountCapabilities(facts("ACTIVE", { realtimeEnabled: false }));
    assert.ok(!allow(c, "canJoinRealtime"));
    assert.ok(getCapabilityDenialReasons(c, "canJoinRealtime").includes("REALTIME_DISABLED"));
    assert.ok(allow(c, "canSendMessage"));
    assert.ok(allow(c, "canAppearInDiscovery"));
  });

  check("V17 push disabled: dating notifications still allowed, push denied PUSH_DISABLED", () => {
    const c = resolveAccountCapabilities(facts("ACTIVE", { pushEnabled: false }));
    assert.ok(allow(c, "canReceiveDatingNotifications"));
    assert.ok(!allow(c, "canReceivePushNotifications"));
    assert.equal(primaryDenialReason(c, "canReceivePushNotifications"), "PUSH_DISABLED");
  });

  check("V18 missing device subscription: push denied DEVICE_SUBSCRIPTION_MISSING, in-app unaffected", () => {
    const c = resolveAccountCapabilities(facts("ACTIVE", { deviceSubscription: false }));
    assert.ok(!allow(c, "canReceivePushNotifications"));
    assert.ok(getCapabilityDenialReasons(c, "canReceivePushNotifications").includes("DEVICE_SUBSCRIPTION_MISSING"));
    assert.ok(allow(c, "canReceiveDatingNotifications"));
  });

  check("V19 trust facts unavailable: ALL protected capabilities fail closed, TRUST_FACTS_UNAVAILABLE", () => {
    const c = resolveAccountCapabilities(facts("ACTIVE", { trustFactsAvailable: false }));
    assert.equal(c.accountState, "UNKNOWN");
    assert.ok(allDenied(c));
    assert.ok(everyPrimary(c, "TRUST_FACTS_UNAVAILABLE"));
  });

  // ---- precedence determinism ---------------------------------------------
  check("precedence: DELETED beats every lesser reason; ordering is stable", () => {
    const c = resolveAccountCapabilities(
      facts("DELETED", { registrationComplete: false, premiumEnabled: false }),
    );
    assert.equal(primaryDenialReason(c, "canPurchasePremium"), "ACCOUNT_DELETED");
    // identical facts -> identical ordering
    const a = resolveAccountCapabilities(facts("LIMITED", { profileVisible: false }));
    const b = resolveAccountCapabilities(facts("LIMITED", { profileVisible: false }));
    assert.deepEqual(a.canAppearInDiscovery.denialReasons, b.canAppearInDiscovery.denialReasons);
  });

  check("discovery reasons are precedence-ordered (status before PROFILE_HIDDEN)", () => {
    const c = resolveAccountCapabilities(facts("SHADOW_BANNED", { profileVisible: false, onboardingDone: false }));
    const r = c.canAppearInDiscovery.denialReasons;
    assert.equal(r[0], "ACCOUNT_SHADOW_BANNED");
    assert.ok(r.indexOf("PROFILE_INCOMPLETE") < r.indexOf("PROFILE_HIDDEN"));
  });

  // ---- helpers + typed error ----------------------------------------------
  check("helpers + assertCapability / CapabilityDeniedError work", () => {
    const c = resolveAccountCapabilities(facts("LIMITED"));
    assert.equal(isCapabilityAllowed(c, "canSwipe"), true);
    assert.equal(isCapabilityAllowed(c, "canLike"), false);
    assert.throws(
      () => assertCapability(c, "canLike"),
      (e: unknown) =>
        e instanceof CapabilityDeniedError &&
        e.capability === "canLike" &&
        e.primaryReason === "ACCOUNT_LIMITED",
    );
    assert.doesNotThrow(() => assertCapability(c, "canSwipe"));
  });

  // ---- GOVERNANCE ---------------------------------------------------------
  const read = (p: string) => readFileSync(p, "utf8");
  check("resolver has NO user-facing prose (machine reasons only)", () => {
    const src = read("src/lib/trust/account-capabilities.ts");
    // A crude prose sniff: no sentence-like copy in the executable strings.
    // Reasons are SCREAMING_SNAKE; forbid obvious UI words.
    assert.doesNotMatch(src, /headline|description|"Complete |"Finish |Please try/i);
  });

  check("resolver COMPOSES canonical predicates, never forks them", () => {
    const src = read("src/lib/trust/account-capabilities.ts");
    assert.match(src, /canEngage\(/);
    assert.match(src, /isDiscoverableStatus\(/);
    assert.match(src, /isRestrictedStatus\(/);
    assert.match(src, /registrationComplete\(/);
    assert.doesNotMatch(src, /\bisPubliclyVerified\s*\(/, "badge passed in, not recomputed");
    assert.doesNotMatch(src, /verifiedGalleryVersion\s*===\s*/, "no forked gallery-version compare");
  });

  check("exactly ONE resolveAccountCapabilities + getAccountCapabilities", () => {
    const src = read("src/lib/trust/account-capabilities.ts");
    assert.equal((src.match(/export function resolveAccountCapabilities\b/g) ?? []).length, 1);
    assert.equal((src.match(/export function getAccountCapabilities\b/g) ?? []).length, 1);
  });

  console.log(`\n${passed} checks passed`);
}

main();
