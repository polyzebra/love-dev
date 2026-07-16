/**
 * The calibration HARNESS (scripts/face-calibrate.ts). Drives it as a
 * subprocess with the MOCK provider over the synthetic manifest - proving
 * it runs comparisons, measures accuracy, recommends thresholds, and writes
 * a versioned report WITHOUT ever applying a threshold - plus the safety
 * refusals (production, missing consent). No real AWS, no real faces.
 *   npx tsx tests/face-calibrate.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const MANIFEST = "data/calibration/manifest.example.json";

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync("npx", ["tsx", "scripts/face-calibrate.ts", ...args], {
    encoding: "utf8",
    env: { ...process.env, FACE_MATCH_PROVIDER: "mock", ...env },
  });
}

async function main() {
  const out = mkdtempSync(path.join(tmpdir(), "cal-"));

  await check(
    "mock dry-run: runs comparisons, measures accuracy, recommends (never applies)",
    () => {
      const r = run(["--manifest", MANIFEST, "--out", out, "--json"]);
      assert.equal(r.status, 0, r.stderr);
      const report = JSON.parse(r.stdout);
      assert.equal(report.kind, "face-calibration-report");
      assert.equal(report.provider, "mock");
      assert.ok(report.sampleCounts.probes >= 10, "probes measured");
      const m = report.metricsAtCurrentThresholds;
      // FALSE ACCEPTANCE must be 0 on the synthetic set (no non-owner accepted).
      assert.equal(m.falseAcceptanceRate, 0, "no false acceptance");
      assert.ok(m.trueAcceptanceRate! > 0, "some true acceptances");
      for (const k of [
        "trueAcceptanceRate",
        "falseAcceptanceRate",
        "trueRejectionRate",
        "falseRejectionRate",
        "manualReviewRate",
        "noFaceRate",
        "multiFaceRate",
        "manipulationRiskRate",
      ])
        assert.ok(k in m, `metric ${k} present`);
      assert.ok("p50" in report.latencyMs && "p95" in report.latencyMs, "latency measured");
      assert.equal(typeof report.estimatedCostUsd, "number", "cost estimated");
      // Recommendation exists and is explicitly NOT applied.
      assert.ok(report.recommendation, "a recommendation is produced");
      assert.match(report.recommendation.note, /not applied|human approval/i);
      // The report carries labels/scores, never raw images.
      assert.ok(
        report.samples.every(
          (s: Record<string, unknown>) => !("image" in s) && !("imagePath" in s),
        ),
      );
      // A versioned report file was written.
      assert.ok(report.reportPaths.json.endsWith(".json") && report.reportPaths.md.endsWith(".md"));
      const disk = JSON.parse(readFileSync(report.reportPaths.json, "utf8"));
      assert.equal(disk.datasetVersion, "example-synthetic-v1");
    },
  );

  await check("never mutates thresholds: no FACE_*_THRESHOLD is written anywhere", () => {
    // The harness is a report generator; it must not persist thresholds.
    const src = readFileSync("scripts/face-calibrate.ts", "utf8");
    assert.ok(!/process\.env\.FACE_[A-Z_]*THRESHOLD\s*=/.test(src), "no threshold assignment");
    assert.ok(!/writeFileSync\([^)]*\.env/.test(src), "does not write an env file");
  });

  await check("REFUSES production (exit 2)", () => {
    const r = run(["--manifest", MANIFEST, "--out", out], { FACE_ENVIRONMENT: "production" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /production/i);
  });

  await check("REFUSES a biometric sample with no consent reference (exit 2)", () => {
    const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
    delete m.samples.find((s: { role: string }) => s.role === "reference").consentRef;
    const p = path.join(out, "no-consent.json");
    writeFileSync(p, JSON.stringify(m));
    const r = run(["--manifest", p, "--out", out]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /consent/i);
  });

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
