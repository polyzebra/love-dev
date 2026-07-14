/**
 * Unit tests for the global verification notices (Phase: UX enhancement):
 *   npx tsx tests/verification-notice.test.ts
 *
 * Pure decision-module matrix - no DB, no env, no browser. The client
 * component only executes these decisions + storage, and the storage keys
 * are session-scoped so a new verification session resets eligibility.
 */
import assert from "node:assert/strict";
import {
  ackKey,
  BANNER_STATES,
  bannerHiddenOn,
  decideVerificationNotice,
  dismissKey,
  TOAST_COPY,
  watchKey,
} from "../src/lib/verification-notice";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const base = {
  sessionId: "vs_123",
  pathname: "/discover",
  watched: false,
  acked: false,
  dismissed: false,
};

console.log("banner visibility");

check("banner visible during every in-flight state on app surfaces", () => {
  for (const state of BANNER_STATES) {
    for (const pathname of ["/discover", "/explore", "/matches", "/chat", "/notifications"]) {
      const d = decideVerificationNotice({ ...base, state, pathname });
      assert.equal(d.showBanner, true, `${state} on ${pathname}`);
    }
  }
});

check("banner hidden on Profile and Account & verification", () => {
  assert.ok(bannerHiddenOn("/profile"));
  assert.ok(bannerHiddenOn("/settings/account"));
  assert.ok(!bannerHiddenOn("/settings"));
  assert.ok(!bannerHiddenOn("/profile/bio"), "only the card-bearing page is excluded");
  for (const pathname of ["/profile", "/settings/account"]) {
    const d = decideVerificationNotice({ ...base, state: "pending", pathname });
    assert.equal(d.showBanner, false, pathname);
  }
});

check("banner disappears on every terminal state", () => {
  for (const state of ["verified", "failed", "retry_available", "not_verified"] as const) {
    const d = decideVerificationNotice({ ...base, state, watched: true });
    assert.equal(d.showBanner, false, state);
  }
});

check("VERIFIED users never see the banner again", () => {
  const d = decideVerificationNotice({ ...base, state: "verified", watched: true, acked: true });
  assert.equal(d.showBanner, false);
  assert.equal(d.toast, null);
});

check("dismissal hides the banner; in-flight state marks the session watched", () => {
  const dismissed = decideVerificationNotice({ ...base, state: "pending", dismissed: true });
  assert.equal(dismissed.showBanner, false);
  const first = decideVerificationNotice({ ...base, state: "pending" });
  assert.equal(first.markWatched, true);
  const again = decideVerificationNotice({ ...base, state: "pending", watched: true });
  assert.equal(again.markWatched, false);
});

console.log("one-time outcome toasts");

check("success toast shown exactly once (watched -> toast; acked -> silent)", () => {
  const first = decideVerificationNotice({ ...base, state: "verified", watched: true });
  assert.equal(first.toast, "verified");
  const refresh = decideVerificationNotice({
    ...base,
    state: "verified",
    watched: true,
    acked: true,
  });
  assert.equal(refresh.toast, null, "refresh/navigation never replays");
});

check("no stale toast on a device that never watched the session", () => {
  const d = decideVerificationNotice({ ...base, state: "verified", watched: false });
  assert.equal(d.toast, null, "fresh devices of long-verified users stay quiet");
});

check("FAILED toast once with the exact copy", () => {
  const d = decideVerificationNotice({ ...base, state: "failed", watched: true });
  assert.equal(d.toast, "failed");
  assert.equal(TOAST_COPY.failed.title, "Photo verification wasn't successful.");
  assert.equal(TOAST_COPY.failed.body, "You can try again anytime.");
  const acked = decideVerificationNotice({ ...base, state: "failed", watched: true, acked: true });
  assert.equal(acked.toast, null);
});

check("RETRY_AVAILABLE toast once with the expired copy", () => {
  const d = decideVerificationNotice({ ...base, state: "retry_available", watched: true });
  assert.equal(d.toast, "expired");
  assert.equal(TOAST_COPY.expired.title, "Verification expired.");
  assert.equal(TOAST_COPY.expired.body, "Start a new verification whenever you're ready.");
});

check("verified copy matches the spec", () => {
  assert.equal(TOAST_COPY.verified.title, "✅ Photo verified");
  assert.equal(TOAST_COPY.verified.body, "Your verified badge is now visible on your profile.");
});

console.log("session scoping");

check("a NEW verification session resets watch/ack/dismiss eligibility", () => {
  assert.notEqual(watchKey("vs_old"), watchKey("vs_new"));
  assert.notEqual(ackKey("vs_old"), ackKey("vs_new"));
  assert.notEqual(dismissKey("vs_old"), dismissKey("vs_new"));
  // Old session acked; the new session decides independently.
  const d = decideVerificationNotice({
    ...base,
    sessionId: "vs_new",
    state: "pending",
    watched: false,
    acked: false,
  });
  assert.equal(d.showBanner, true);
});

check("no session -> nothing ever renders", () => {
  const d = decideVerificationNotice({ ...base, sessionId: null, state: "pending" });
  assert.deepEqual(d, { showBanner: false, toast: null, markWatched: false });
});

console.log(`\n${passed} checks passed`);
