/**
 * Verification UX consistency tests:
 *   npx tsx tests/verification-consistency.test.ts
 *
 * One canonical state (deriveVerificationUxState) -> ONE mapper
 * (photoVerificationRow) -> every surface. This suite proves the
 * impossible state ("Photo verified -> Verify" alongside "Verification
 * in progress") cannot be rendered, and that Profile/Settings/Card agree
 * for every canonical state. Pure - no DB, no browser.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { photoVerificationRow } from "../src/components/shared/verification-status-row";
import type { VerificationUxState } from "../src/lib/services/photo-verification";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}
const src = (...parts: string[]) => readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
const code = (...parts: string[]) =>
  src(...parts)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

const ALL_STATES: VerificationUxState[] = [
  "not_verified",
  "verification_started",
  "pending",
  "verified",
  "failed",
  "retry_available",
  "manual_review",
];
const IN_FLIGHT: VerificationUxState[] = ["pending", "verification_started", "manual_review"];
const cfg = { configured: true };

console.log("per-state required behavior");

check("NOT_VERIFIED: Verify on profile, Start in settings", () => {
  const profile = photoVerificationRow("not_verified", { ...cfg, surface: "profile" });
  const settings = photoVerificationRow("not_verified", { ...cfg, surface: "settings" });
  assert.equal(profile.state, "todo");
  assert.equal(profile.action?.label, "Verify");
  assert.equal(profile.action?.href, "#photo-verification");
  assert.equal(settings.action?.label, "Start");
  assert.equal(settings.action?.href, "/profile#photo-verification");
  assert.equal(profile.state, settings.state, "same visual state");
});

check("IN PROGRESS (pending + session_created): no Verify CTA anywhere", () => {
  for (const state of ["pending", "verification_started"] as const) {
    const profile = photoVerificationRow(state, { ...cfg, surface: "profile" });
    const settings = photoVerificationRow(state, { ...cfg, surface: "settings" });
    assert.equal(profile.state, "pending", state);
    assert.equal(profile.value, "In progress");
    assert.equal(profile.action, null, "profile row has NO CTA while in progress");
    assert.equal(settings.value, "In progress");
    assert.deepEqual(settings.action, {
      label: "View status",
      href: "/profile#photo-verification",
    });
    assert.equal(profile.state, settings.state);
  }
});

check("MANUAL_REVIEW: Under review on both, no CTA", () => {
  for (const surface of ["profile", "settings"] as const) {
    const row = photoVerificationRow("manual_review", { ...cfg, surface });
    assert.equal(row.state, "pending");
    assert.equal(row.value, "Under review");
    assert.equal(row.action, null);
  }
});

check("VERIFIED: verified state, no action, card hidden", () => {
  for (const surface of ["profile", "settings"] as const) {
    const row = photoVerificationRow("verified", { ...cfg, surface });
    assert.equal(row.state, "verified");
    assert.equal(row.label, "Photo verified");
    assert.equal(row.action, null);
  }
  const page = code("app", "(app)", "profile", "page.tsx");
  assert.ok(
    page.includes("!verification.photoVerified && (") ||
      page.includes("{!verification.photoVerified &&"),
    "PhotoVerifyCard renders only while unverified",
  );
});

check("RETRY_AVAILABLE / EXPIRED: Try again on both surfaces", () => {
  const profile = photoVerificationRow("retry_available", { ...cfg, surface: "profile" });
  const settings = photoVerificationRow("retry_available", { ...cfg, surface: "settings" });
  assert.equal(profile.state, "needs-action");
  assert.equal(profile.action?.label, "Try again");
  assert.equal(settings.action?.label, "Try again");
  assert.equal(settings.action?.href, "/profile#photo-verification");
});

check("FAILED (staff-marked final): consistent no-retry on every surface", () => {
  // The card's failed state is deliberately final (isFinalRejection) -
  // the rows mirror it instead of dangling a Try-again the card refuses.
  for (const surface of ["profile", "settings"] as const) {
    const row = photoVerificationRow("failed", { ...cfg, surface });
    assert.equal(row.state, "needs-action");
    assert.equal(row.action, null);
  }
});

console.log("impossibility + single-source guarantees");

check("the reported bug is impossible: no in-flight state carries a Verify CTA", () => {
  for (const state of IN_FLIGHT) {
    for (const surface of ["profile", "settings"] as const) {
      const row = photoVerificationRow(state, { ...cfg, surface });
      assert.notEqual(row.action?.label, "Verify", `${state}/${surface}`);
      assert.notEqual(row.action?.label, "Start", `${state}/${surface}`);
      assert.notEqual(row.state, "verified", `${state}/${surface} never claims verified`);
    }
  }
});

check("profile and settings agree on visual state for EVERY canonical state", () => {
  for (const state of ALL_STATES) {
    for (const configured of [true, false]) {
      const profile = photoVerificationRow(state, { configured, surface: "profile" });
      const settings = photoVerificationRow(state, { configured, surface: "settings" });
      assert.equal(profile.state, settings.state, `${state} configured=${configured}`);
      assert.equal(profile.value, settings.value, `${state}: same status wording`);
      // CTA POLICY may differ by surface (settings adds View status while
      // in flight; profile stays quiet next to the card) - but a
      // start-style CTA must appear on BOTH or NEITHER.
      const startLabels = new Set(["Verify", "Start", "Try again"]);
      assert.equal(
        startLabels.has(profile.action?.label ?? ""),
        startLabels.has(settings.action?.label ?? ""),
        `${state}: start-style CTA parity`,
      );
    }
  }
});

check("no surface derives verification state on its own any more", () => {
  const profile = code("app", "(app)", "profile", "page.tsx");
  assert.ok(
    !/verification\.photoVerified,\s*"#photo-verification"/.test(profile),
    "profile photo row no longer boolean-derived",
  );
  assert.ok(profile.includes("photoVerificationRow(verificationUx"), "profile uses the mapper");
  const settings = code("app", "(app)", "settings", "account", "page.tsx");
  assert.ok(!settings.includes('photoStatus === "PENDING"'), "local settings switch removed");
  assert.ok(settings.includes("deriveVerificationUxState"), "settings reads the canonical state");
  assert.ok(settings.includes("photoVerificationRow(photoUx"), "settings uses the mapper");
  const card = src("components", "profile", "photo-verify-card.tsx");
  assert.ok(card.includes('title="Under review"'), "card copy aligned");
});

check("navigation always targets the ONE flow implementation", () => {
  for (const state of ALL_STATES) {
    for (const surface of ["profile", "settings"] as const) {
      const row = photoVerificationRow(state, { ...cfg, surface });
      if (row.action) {
        assert.ok(
          row.action.href.endsWith("#photo-verification"),
          `${state}/${surface} -> ${row.action.href}`,
        );
      }
    }
  }
});

console.log(`\n${passed} checks passed`);
