/**
 * L9.5.1 - admin-only liveness diagnostic surface. Source-contract checks that
 * the endpoint is admin-gated and the diagnostic shape exposes ONLY non-PII
 * fields (so a stuck production attempt's real AWS status is observable without
 * leaking flowId/sessionId/email/uid/credentials/media/scores). Run:
 *   npx tsx tests/liveness-diagnostic.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const ROUTE = "src/app/api/admin/liveness-diagnostic/route.ts";
const SVC = "src/lib/services/face-liveness.ts";
const read = (p: string) => readFileSync(p, "utf8");

/** Body of getLivenessFlowDiagnostic - the returned object. */
function diagReturn(src: string): string {
  const start = src.indexOf("export async function getLivenessFlowDiagnostic");
  assert.notEqual(start, -1, "diagnostic function must exist");
  return src.slice(start);
}

function main() {
  check("diagnostic endpoint is admin-gated (verifications:review)", () => {
    const src = read(ROUTE);
    assert.match(src, /requirePermission\("verifications:review"\)/);
  });

  check("diagnostic is a pure read - it never consumes or enrolls the session", () => {
    const body = diagReturn(read(SVC));
    // It may call getLivenessResult (a read) but must NOT consume/enroll/mutate.
    assert.doesNotMatch(body, /enrollReferenceSaga|status: "CONSUMED"|status: "PASSED"|updateMany|\.update\(/);
    assert.match(body, /getLivenessResult\(session\.sessionId\)/, "reads the live provider status");
  });

  check("diagnostic surfaces the operator-required non-PII fields", () => {
    const body = diagReturn(read(SVC));
    for (const field of [
      "flowSuffix",
      "applicationState",
      "providerStatus",
      "attemptAgeMs",
      "consumed",
      "lastSafeErrorCode",
      "referenceEnrolled",
      "profilePhotoStatus",
      "matchProviderHealth",
    ]) {
      assert.match(body, new RegExp(`\\b${field}\\b`), `must expose ${field}`);
    }
  });

  // ---- L9.8: liveness start is decoupled from the photo-match circuit --------
  check("L9.8: liveness START does not pre-gate on the face_match circuit breaker", () => {
    const route = readFileSync("src/app/api/verification/liveness/route.ts", "utf8");
    // The photo-MATCH circuit (CompareFaces failures) must NOT block starting a
    // liveness capture (CreateFaceLivenessSession) - a different AWS API.
    assert.doesNotMatch(route, /providerHealthState\(`face_match:/, "must not gate liveness on the match circuit");
    assert.doesNotMatch(route, /import.*providerHealthState/, "unused breaker import removed");
  });

  check("L9.8: every provider_unavailable path carries a distinct, logged reason", () => {
    const route = readFileSync("src/app/api/verification/liveness/route.ts", "utf8");
    const svc = read(SVC);
    // The route logs each refusal with a machine reason (no PII).
    assert.match(route, /reason=layer_off/);
    assert.match(route, /reason=admit_refused/);
    assert.match(route, /reason=\$\{created\.reason\}/);
    // createBoundLivenessSession distinguishes WHY it failed.
    assert.match(svc, /no_provider_method/);
    assert.match(svc, /no_job_row/);
    assert.match(svc, /create_session_failed:/);
  });

  check("diagnostic exposes only the flow SUFFIX, never the full flowId or sessionId", () => {
    const body = diagReturn(read(SVC));
    assert.match(body, /flowId\.slice\(-6\)/, "only the last 6 chars of the flow id");
    // The returned object literal must not put the raw sessionId/flowId/email/uid on the wire.
    const ret = body.slice(body.indexOf("return {"));
    assert.doesNotMatch(ret, /sessionId:|\bflowId:|email|authUid|\buserId:/, "no raw identifiers returned");
  });

  check("per-poll diagnostic uses console.warn (Vercel-visible) and stays non-PII", () => {
    const src = read(SVC);
    assert.match(src, /console\.warn\(\s*\n?\s*`\[liveness\] poll/, "poll log is console.warn");
    const line = src.slice(src.indexOf("[liveness] poll"), src.indexOf("[liveness] poll") + 200);
    assert.doesNotMatch(line, /session\.userId|session\.sessionId/, "no userId/sessionId in the log");
  });

  console.log(`\n${passed} checks passed`);
}

main();
