/**
 * Security-header governance. The Permissions-Policy must PERMIT the camera for
 * same-origin (self) - the AWS Face Liveness component runs first-party and calls
 * getUserMedia, so an empty `camera=()` allowlist silently prevents the liveness
 * camera from ever opening (L9.2 root cause). This guards against that regression.
 * Run:  npx tsx tests/security-headers.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

function main() {
  const cfg = readFileSync("next.config.ts", "utf8");
  const m = /"Permissions-Policy",\s*value:\s*"([^"]*)"/.exec(cfg);
  assert.ok(m, "Permissions-Policy header must be present");
  const policy = m![1];

  check("Permissions-Policy permits the camera for self (liveness needs getUserMedia)", () => {
    assert.match(policy, /camera=\(self\)/, `camera must allow self, got: ${policy}`);
  });

  check("Permissions-Policy never denies the camera outright (camera=())", () => {
    assert.doesNotMatch(
      policy,
      /camera=\(\)/,
      "camera=() denies the camera to EVERY origin and breaks Face Liveness",
    );
  });

  check("microphone stays denied (liveness is video-only) and geolocation stays self", () => {
    assert.match(policy, /microphone=\(\)/, "microphone should remain denied");
    assert.match(policy, /geolocation=\(self\)/, "geolocation should remain self");
  });

  console.log(`\n${passed} checks passed`);
}

main();
