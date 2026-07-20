/**
 * Capability PARITY: proves the canonical resolver agrees with the OTHER
 * execution layers that must express the same policy in their own form -
 * the Discovery DB query (E/F) and the realtime RLS SQL (K/L). Tests BEHAVIOUR
 * across a status matrix, not source strings. Pure; no DB. Run:
 *   npx tsx tests/capability-parity.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveAccountCapabilities, type CapabilityFacts } from "../src/lib/trust/account-capabilities";
import { DISCOVERABLE_STATUSES } from "../src/lib/services/trust-safety";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const ALL_STATUSES = [
  "PENDING",
  "ACTIVE",
  "LIMITED",
  "PHOTO_REVIEW_REQUIRED",
  "SUSPENDED",
  "BANNED",
  "SHADOW_BANNED",
  "DEACTIVATED",
  "DELETED",
];

/** status ACTIVE/LIMITED/PHOTO_REVIEW imply registration complete (activator +
 *  DB CHECK constraint). PENDING is the only incomplete one. */
function facts(status: string, over: Partial<CapabilityFacts> = {}): CapabilityFacts {
  return {
    status,
    registrationComplete: status !== "PENDING",
    onboardingDone: true,
    profileVisible: true,
    badgeVisible: false,
    ...over,
  };
}

function main() {
  // =====================================================================
  // PHASE E/F - Discovery query policy <-> resolver.canAppearInDiscovery
  // =====================================================================
  // The canonical candidate query is DISCOVERABLE_USER_WHERE
  // (status IN DISCOVERABLE_STATUSES AND onboardingDone) plus profile.isVisible,
  // applied by discovery.ts/explore.ts. This predicate is DERIVED from the same
  // canonical status list - no duplicate literal.
  const discoveryQueryIncludes = (status: string, onboardingDone: boolean, profileVisible: boolean) =>
    (DISCOVERABLE_STATUSES as readonly string[]).includes(status) && onboardingDone && profileVisible;

  check("DISCOVERY PARITY: resolver.canAppearInDiscovery === query inclusion (full matrix)", () => {
    for (const status of ALL_STATUSES) {
      for (const onboardingDone of [true, false]) {
        for (const profileVisible of [true, false]) {
          const caps = resolveAccountCapabilities(facts(status, { onboardingDone, profileVisible }));
          const query = discoveryQueryIncludes(status, onboardingDone, profileVisible);
          assert.equal(
            caps.canAppearInDiscovery.allowed,
            query,
            `status=${status} onboarding=${onboardingDone} visible=${profileVisible}`,
          );
        }
      }
    }
  });

  check("DISCOVERY PARITY: Explore/Search/Recommend/PublicProfile share the SAME decision", () => {
    for (const status of ALL_STATUSES) {
      const c = resolveAccountCapabilities(facts(status));
      const base = c.canAppearInDiscovery.allowed;
      assert.equal(c.canAppearInExplore.allowed, base, `${status} explore`);
      assert.equal(c.canAppearInSearch.allowed, base, `${status} search`);
      assert.equal(c.canBeRecommended.allowed, base, `${status} recommend`);
      assert.equal(c.canExposePublicProfile.allowed, base, `${status} public profile`);
    }
  });

  // =====================================================================
  // PHASE K/L - realtime RLS <-> resolver.canJoinRealtime
  // =====================================================================
  // The canonical RLS contract (mirrors the existing SQL - NOT changed here).
  const REALTIME_RLS_STATUS_CONTRACT = {
    joinableStatuses: ["ACTIVE", "SHADOW_BANNED"] as const,
    participantRequired: true,
  };

  check("REALTIME PARITY: resolver.canJoinRealtime === RLS joinableStatuses (every status)", () => {
    for (const status of ALL_STATUSES) {
      const caps = resolveAccountCapabilities(facts(status));
      const rlsAllows = (REALTIME_RLS_STATUS_CONTRACT.joinableStatuses as readonly string[]).includes(
        status,
      );
      assert.equal(caps.canJoinRealtime.allowed, rlsAllows, `status=${status}`);
      assert.equal(caps.canReceiveRealtime.allowed, rlsAllows, `status=${status} receive`);
    }
  });

  check("REALTIME PARITY: the live RLS SQL still encodes the contract's status list", () => {
    // Behaviour-anchored marker: if the SQL status list changes, this fails and
    // forces the matrix + contract to change in lockstep (no one-layer drift).
    const sql = readFileSync(
      "prisma/migrations/20260713150000_realtime_chat_authorization/migration.sql",
      "utf8",
    );
    for (const s of REALTIME_RLS_STATUS_CONTRACT.joinableStatuses) {
      assert.match(sql, new RegExp(`'${s}'`), `RLS SQL must list ${s}`);
    }
    // And it must NOT silently admit a status the resolver denies for realtime.
    for (const forbidden of ["LIMITED", "PHOTO_REVIEW_REQUIRED", "PENDING"]) {
      assert.doesNotMatch(
        sql,
        new RegExp(`status IN \\([^)]*'${forbidden}'`),
        `RLS must not join ${forbidden}`,
      );
    }
  });

  check("PRESERVED DIVERGENCE: PHOTO_REVIEW sends but cannot join; SHADOW_BANNED joins but cannot send", () => {
    const pr = resolveAccountCapabilities(facts("PHOTO_REVIEW_REQUIRED"));
    assert.equal(pr.canSendMessage.allowed, true);
    assert.equal(pr.canJoinRealtime.allowed, false);
    const sb = resolveAccountCapabilities(facts("SHADOW_BANNED"));
    assert.equal(sb.canJoinRealtime.allowed, true);
    assert.equal(sb.canSendMessage.allowed, false);
    assert.equal(sb.canAppearInDiscovery.allowed, false);
  });

  console.log(`\n${passed} checks passed`);
}

main();
