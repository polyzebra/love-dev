/**
 * L8.3.5 - AWS Face Liveness launch-failure mapping. The reported bug: after
 * "Agree & start" the AWS camera never opened, yet the UI showed
 * "That didn't work - lighting or movement" (capture_failed). That copy is a
 * REAL-capture verdict; a start-time failure must never wear it.
 *
 * These are pure/source-contract checks (the capture UI is a React + fetch
 * component with no jsdom harness here), proving the invariants that make the
 * misleading path unreachable. Run:
 *   npx tsx tests/liveness-launch-error-mapping.test.ts
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
const ROUTE = "src/app/api/verification/liveness/route.ts";
const read = (p: string) => readFileSync(p, "utf8");

/** The body of startCapture() only - the pre-camera launch path. */
function startCaptureBody(src: string): string {
  const start = src.indexOf("async function startCapture()");
  assert.notEqual(start, -1, "startCapture() must exist");
  // Ends where the detector-error mapper begins (handleDetectorError follows it).
  const end = src.indexOf("function handleDetectorError", start);
  assert.notEqual(end, -1, "expected handleDetectorError after startCapture()");
  return src.slice(start, end);
}

/** The body of handleDetectorError() - the FaceLivenessDetector error mapper. */
function detectorErrorBody(src: string): string {
  const start = src.indexOf("function handleDetectorError");
  assert.notEqual(start, -1, "handleDetectorError() must exist");
  const end = src.indexOf("const copy = LIVENESS_COPY[state]", start);
  assert.notEqual(end, -1, "expected marker after handleDetectorError()");
  return src.slice(start, end);
}

function main() {
  // ---- Copy: distinct pre-camera states exist -------------------------------
  check("start_failed + network_error copy exist and are distinct from capture_failed", () => {
    for (const k of ["start_failed", "network_error", "capture_failed"] as const) {
      assert.ok(LIVENESS_COPY[k], `missing copy for ${k}`);
      assert.ok(LIVENESS_COPY[k].title.length > 0 && LIVENESS_COPY[k].body.length > 0);
    }
    assert.notEqual(LIVENESS_COPY.start_failed.title, LIVENESS_COPY.capture_failed.title);
    assert.notEqual(LIVENESS_COPY.network_error.title, LIVENESS_COPY.capture_failed.title);
  });

  // ---- "lighting or movement" is a REAL-capture verdict only ----------------
  check("ONLY capture_failed carries the 'lighting or movement' copy", () => {
    for (const [state, copy] of Object.entries(LIVENESS_COPY)) {
      const text = `${copy.title} ${copy.body}`.toLowerCase();
      if (state === "capture_failed") {
        assert.match(text, /lighting or movement/, "capture_failed should keep its copy");
      } else {
        assert.doesNotMatch(text, /lighting or movement/, `${state} must NOT claim lighting/movement`);
      }
    }
  });

  check("start_failed + network_error copy explicitly disclaim the camera / user's photos", () => {
    // The user must not read a pre-camera failure as their fault.
    assert.match(LIVENESS_COPY.start_failed.body.toLowerCase(), /our side|not your photos|before the camera/);
    assert.match(LIVENESS_COPY.network_error.body.toLowerCase(), /connection|reach/);
  });

  // ---- THE core invariant: no lighting/movement before the AWS camera -------
  check("K#16: startCapture() can NEVER set capture_failed (camera hasn't run)", () => {
    const body = startCaptureBody(read(CLIENT));
    assert.doesNotMatch(
      body,
      /setState\("capture_failed"\)/,
      "startCapture must not reach the lighting/movement state",
    );
  });

  check("K#4: a non-ok start response maps to start_failed, a thrown fetch to network_error", () => {
    const body = startCaptureBody(read(CLIENT));
    assert.match(body, /setState\("start_failed"\)/, "server-error path -> start_failed");
    assert.match(body, /setState\("network_error"\)/, "network-error path -> network_error");
    assert.match(body, /setState\("provider_unavailable"\)/, "503 path -> provider_unavailable");
  });

  check("K#3: a 200 with no flowId does NOT open the camera (start_failed, not submitted)", () => {
    const body = startCaptureBody(read(CLIENT));
    // Guard present: absence of data.flowId is handled before setFlowId/capture_submitted.
    assert.match(body, /!body\?\.data\?\.flowId/, "missing flowId must be guarded");
  });

  // ---- Retry starts a fresh session -----------------------------------------
  check("retry drops any stale flowId so a fresh AWS session is created", () => {
    const body = startCaptureBody(read(CLIENT));
    assert.match(body, /setFlowId\(null\)/, "startCapture must reset flowId before starting");
  });

  // ---- capture_failed only from a REAL capture / poll -----------------------
  check("capture_failed is reachable ONLY from the detector onFailed + the poll effect", () => {
    const src = read(CLIENT);
    const occurrences = (src.match(/setState\("capture_failed"\)/g) ?? []).length;
    // onFailed={() => setState("capture_failed")} + two poll branches
    // (session_not_found, capture_failed). Never from startCapture.
    assert.ok(occurrences >= 1, "detector/poll must still be able to report a real capture failure");
    const body = startCaptureBody(src);
    assert.doesNotMatch(body, /setState\("capture_failed"\)/);
  });

  // ---- Server route: Stripe prerequisite is gone ----------------------------
  check("liveness route no longer requires Stripe identity (no 409 identity_required)", () => {
    // Strip comments so we assert on EXECUTABLE code, not explanatory prose.
    const code = read(ROUTE)
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");
    assert.doesNotMatch(code, /identity_required/, "the Stripe 409 gate must be removed");
    assert.doesNotMatch(code, /photoVerifiedAt/, "route must not read photoVerifiedAt anymore");
  });

  check("liveness route ensures the ProfilePhotoVerification row before creating a session", () => {
    const src = read(ROUTE);
    const enqueueAt = src.indexOf("enqueueProfilePhotoVerification(");
    const createAt = src.indexOf("createBoundLivenessSession(");
    assert.notEqual(enqueueAt, -1, "must enqueue/ensure the row");
    assert.notEqual(createAt, -1, "must create the bound session");
    assert.ok(enqueueAt < createAt, "the row must be ensured BEFORE the session is minted");
  });

  check("liveness route keeps the config/legal gate (isFaceMatchConfigured)", () => {
    const src = read(ROUTE);
    assert.match(src, /isFaceMatchConfigured\(\)/, "the compliance/config gate must remain");
  });

  // ---- L9.3: iOS Safari camera-open + correct pre-capture error mapping ------
  const DETECTOR = "src/components/profile/liveness-detector.tsx";

  check("L9.3: detector does NOT disableStartScreen (iOS needs the Begin gesture)", () => {
    const src = read(DETECTOR);
    assert.doesNotMatch(
      src.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n"),
      /disableStartScreen/,
      "disableStartScreen auto-starts camera with no gesture and fails on iOS",
    );
  });

  check("L9.3: startCapture no longer pre-probes getUserMedia (detector owns the camera)", () => {
    const body = startCaptureBody(read(CLIENT));
    assert.doesNotMatch(body, /getUserMedia/, "no pre-probe; the AWS start screen acquires the camera");
  });

  check("L9.3: a CAMERA_ACCESS_ERROR maps to permission, NOT lighting/movement", () => {
    const body = detectorErrorBody(read(CLIENT));
    assert.match(body, /CAMERA_ACCESS_ERROR/);
    // CAMERA_ACCESS_ERROR precedes camera_permission_required; the mapper never
    // sends a camera/permission error to capture_failed.
    const camIdx = body.indexOf("CAMERA_ACCESS_ERROR");
    const permIdx = body.indexOf('setState("camera_permission_required")', camIdx);
    assert.ok(permIdx > camIdx, "CAMERA_ACCESS_ERROR must map to camera_permission_required");
  });

  check("L9.3: the mapper's DEFAULT is a component failure, never capture_failed", () => {
    const body = detectorErrorBody(read(CLIENT));
    const def = body.lastIndexOf("default:");
    assert.notEqual(def, -1, "mapper must have a default branch");
    const tail = body.slice(def);
    assert.match(tail, /setState\("liveness_component_failed"\)/, "default -> component failure");
    assert.doesNotMatch(tail, /setState\("capture_failed"\)/, "default must NOT claim lighting/movement");
  });

  check("L9.3: capture_failed is set only for genuine mid-capture error states", () => {
    const body = detectorErrorBody(read(CLIENT));
    // The capture_failed branch must be guarded by mid-capture states (TIMEOUT etc.).
    const cf = body.indexOf('setState("capture_failed")');
    assert.notEqual(cf, -1, "mid-capture failures still map to capture_failed");
    const before = body.slice(0, cf);
    assert.match(before, /"TIMEOUT"|"FRESHNESS_TIMEOUT"|"FACE_DISTANCE_ERROR"|"MULTIPLE_FACES_ERROR"/);
  });

  console.log(`\n${passed} checks passed`);
}

main();
