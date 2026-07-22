/**
 * L9.4 - post-capture lifecycle (bounded polling, terminal timeout, server-
 * authoritative PASS) + mobile full-screen presentation. Source-contract checks
 * (the capture UI is a React + fetch component with no jsdom harness here) that
 * lock the invariants which stop the indefinite "Verifying…" spinner and keep the
 * AWS surface off the bottom nav / status bar. Run:
 *   npx tsx tests/liveness-lifecycle.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LIVENESS_COPY } from "../src/lib/verification-presentation";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const CLIENT = "src/components/profile/liveness-capture.tsx";
const CARD = "src/components/profile/photo-verify-card.tsx";
const SHELL = "src/components/profile/liveness-fullscreen.tsx";
const read = (p: string) => readFileSync(p, "utf8");

function main() {
  // ---- Bounded liveness poll + terminal timeout -----------------------------
  check("result_timeout copy exists, is terminal, and never claims lighting/movement", () => {
    assert.ok(LIVENESS_COPY.result_timeout, "result_timeout copy must exist");
    const text = `${LIVENESS_COPY.result_timeout.title} ${LIVENESS_COPY.result_timeout.body}`;
    assert.doesNotMatch(text.toLowerCase(), /lighting or movement/, "timeout is not a capture failure");
    assert.match(text.toLowerCase(), /couldn't finish|not available|try again/);
  });

  check("liveness poll has a HARD deadline that ends in result_timeout (no infinite spinner)", () => {
    const src = read(CLIENT);
    assert.match(src, /DEADLINE_MS/, "a hard deadline constant must exist");
    assert.match(src, /elapsed >= DEADLINE_MS/, "the poll must check the deadline");
    assert.match(src, /setState\("result_timeout"\)/, "past the deadline -> result_timeout");
  });

  check("liveness poll only runs while liveness_processing (bounded, not always-on)", () => {
    const src = read(CLIENT);
    assert.match(src, /state !== "liveness_processing"\) return/, "poll gated on liveness_processing");
  });

  check("liveness poll cancels in-flight requests on teardown (AbortController)", () => {
    const src = read(CLIENT);
    assert.match(src, /new AbortController\(\)/);
    assert.match(src, /controller\.abort\(\)/, "cleanup must abort the request");
  });

  check("result_timeout is retryable (fresh session): in canStart + resets flow", () => {
    const src = read(CLIENT);
    assert.match(src, /state === "result_timeout"/, "result_timeout must be a start-able state");
    // startCapture resets flowId + advisory before a fresh attempt.
    assert.match(src, /setFlowId\(null\);\s*\n\s*setTakingLong\(false\)/);
  });

  // ---- Server-authoritative PASS -------------------------------------------
  check("client never self-marks verified: success only follows the server's checking_profile_photos", () => {
    const src = read(CLIENT);
    // The only "success" transition is a server-reported state that triggers a refresh.
    assert.match(src, /next === "checking_profile_photos"/);
    assert.match(src, /router\.refresh\(\)/);
    // No client-forged verified/passed state exists in the capture state machine.
    assert.doesNotMatch(src, /setState\("verified"\)|setState\("passed"\)/);
  });

  // ---- Post-PASS photo-check card is bounded too -----------------------------
  check("checking_profile_photos card polls with a hard deadline + terminal timeout", () => {
    const src = read(CARD);
    assert.match(src, /facePresentation !== "checking_profile_photos"/, "poller gated on the phase");
    assert.match(src, /PHOTO_DEADLINE_MS/, "a hard deadline must bound the photo-check spinner");
    assert.match(src, /setPhotoCheckTimedOut\(true\)/, "deadline -> terminal timeout");
    assert.match(src, /photoCheckTimedOut/, "a timeout branch must render instead of a spinner");
  });

  // ---- Mobile full-screen presentation --------------------------------------
  check("active capture renders in the full-screen shell (get-ready + camera + processing)", () => {
    const src = read(CLIENT);
    assert.match(src, /const isFullscreen =\s*\n?\s*state === "capture_submitted" \|\| state === "liveness_processing"/);
    assert.match(src, /<LivenessFullscreen/, "active states must use the full-screen shell");
  });

  check("shell is a fixed full-viewport layer ABOVE the bottom nav (z-40)", () => {
    const src = read(SHELL);
    assert.match(src, /fixed inset-0/, "fixed inset-0 full-viewport");
    assert.match(src, /\bz-50\b/, "z-50 sits above the z-40 bottom nav");
    assert.match(src, /bg-background/, "opaque background covers the gallery behind");
    assert.match(src, /100dvh/, "dvh (not vh) so iOS toolbars don't clip the CTA");
  });

  check("shell respects the safe-area insets (status bar / home indicator)", () => {
    const src = read(SHELL);
    assert.match(src, /env\(safe-area-inset-top\)/);
    assert.match(src, /env\(safe-area-inset-bottom\)/);
  });

  check("shell locks background scroll and RESTORES it on close", () => {
    const src = read(SHELL);
    assert.match(src, /document\.body\.style\.overflow = "hidden"/, "lock scroll while open");
    assert.match(src, /document\.body\.style\.overflow = prevOverflow/, "restore scroll on close");
  });

  check("shell is an accessible dialog with focus restore", () => {
    const src = read(SHELL);
    assert.match(src, /role="dialog"/);
    assert.match(src, /aria-modal="true"/);
    assert.match(src, /prevFocus\.current\?\.focus/, "focus returns to the trigger on close");
    assert.match(src, /aria-label="Close verification"/, "close control is labelled");
  });

  check("shell has a Tirvea top bar (identity + step) - not a raw provider widget", () => {
    const src = read(SHELL);
    assert.match(src, /Tirvea verification/, "top bar identifies the Tirvea flow");
    assert.match(src, /\{step\}/, "top bar shows the concise step label");
  });

  // ---- L9.5: liveness result is diagnosable (real AWS status observable) -----
  const REKOG = "src/lib/services/aws-rekognition.ts";
  const SVC = "src/lib/services/face-liveness.ts";

  check("getLivenessResult surfaces the raw AWS status (providerStatus)", () => {
    const src = read(REKOG);
    assert.match(src, /providerStatus: status/, "raw AWS Status carried for diagnostics");
  });

  check("consumeLivenessFlow logs the real AWS status per poll (redacted, no PII)", () => {
    const src = read(SVC);
    assert.match(src, /awsStatus=\$\{result\.providerStatus/, "logs the raw vendor status");
    assert.doesNotMatch(src, /session\.userId\b.*console|console.*session\.userId/, "no userId in logs");
  });

  check("a thrown provider error is terminal provider_unavailable, never endless pending", () => {
    const src = read(SVC);
    // The catch around getLivenessResult returns a terminal state.
    assert.match(src, /catch \(error\) \{[\s\S]*?return \{ state: "provider_unavailable" \}/);
  });

  console.log(`\n${passed} checks passed`);
}

main();
