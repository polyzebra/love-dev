/**
 * External operational alert channel (Phase 7). Proves the dry-run delivers
 * through the external channel (no PII, failure tolerated), and that the new
 * config/state rules (emergency disable, region mismatch) fire through the
 * same channel. Live lane (evaluate reads metrics from the DB). Run with:
 *   npx tsx tests/ops-alerts.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

type Payload = { kind: string; severity: string; detail: string; status: string };

async function main() {
  const { sendTestOpsAlert, setExternalAlertTransport, ALERT_POLICY, raiseOpsAlert } =
    await import("../src/lib/services/provider-resilience");
  const { evaluateVerificationAlerts } = await import("../src/lib/services/verification-metrics");
  const { db } = await import("../src/lib/db");

  const captured: Payload[] = [];
  const capturing = async (p: Payload) => {
    captured.push(p);
    return true;
  };

  const savedEnv: Record<string, string | undefined> = {};
  const env = process.env as Record<string, string | undefined>;
  for (const k of [
    "FACE_EMERGENCY_DISABLE",
    "FACE_MATCH_PROVIDER",
    "AWS_REGION",
    "AWS_REKOGNITION_REGION",
    "FACE_LEGAL_APPROVAL_VERSION",
  ])
    savedEnv[k] = env[k];

  try {
    console.log("dry-run: verify the external channel end to end");
    await check("sendTestOpsAlert delivers a PII-free payload through the channel", async () => {
      setExternalAlertTransport(capturing);
      captured.length = 0;
      const r = await sendTestOpsAlert("unit");
      assert.equal(r.channelConfigured, true, "an injected channel counts as configured");
      assert.equal(r.delivered, true);
      assert.equal(captured.length, 1);
      const p = captured[0];
      assert.equal(p.kind, "ops_alert_test");
      assert.equal(p.severity, "warning");
      // No PII: only kind/severity/detail/status, and detail is generic copy.
      assert.deepEqual(Object.keys(p).sort(), ["detail", "kind", "severity", "status"]);
      assert.ok(
        !/@|\buser\b|\bemail\b|[0-9a-f]{8}-[0-9a-f]{4}/i.test(p.detail),
        "no PII in detail",
      );
    });

    await check("a channel FAILURE is tolerated (reported, never thrown)", async () => {
      setExternalAlertTransport(async () => {
        throw new Error("webhook down");
      });
      const r = await sendTestOpsAlert("fail");
      assert.equal(r.delivered, false, "delivery failure surfaces as false, no crash");
    });

    await check("no channel configured -> nothing sent, no crash", async () => {
      setExternalAlertTransport(null);
      delete env.ALERT_WEBHOOK_URL;
      const r = await sendTestOpsAlert("none");
      assert.deepEqual(r, { channelConfigured: false, delivered: false });
    });

    console.log("required alert kinds exist in the policy");
    await check("policy covers the Phase-7 config/state + rate kinds", async () => {
      for (const k of [
        "legal_gate_missing",
        "region_mismatch",
        "emergency_disable_active",
        "suspension_spike",
        "manual_review_spike",
        "cron_failure",
        "face_dead_letter",
        "reference_deletion_failure",
        "provider_down",
      ])
        assert.ok(ALERT_POLICY[k], `ALERT_POLICY has ${k}`);
    });

    console.log("config/state rules fire through the channel");
    await check(
      "emergency-disable ON -> fires emergency_disable_active (high, no PII)",
      async () => {
        setExternalAlertTransport(capturing);
        captured.length = 0;
        env.FACE_EMERGENCY_DISABLE = "1";
        const fired = await evaluateVerificationAlerts();
        assert.ok(fired.includes("emergency_disable_active"), "rule fired");
        const p = captured.find((x) => x.kind === "emergency_disable_active");
        assert.ok(p, "delivered to the external channel");
        assert.equal(p!.severity, "high");
        assert.ok(!/@|[0-9a-f]{8}-[0-9a-f]{4}/i.test(p!.detail), "no PII");
      },
    );

    await check("AWS region mismatch -> fires region_mismatch", async () => {
      setExternalAlertTransport(capturing);
      captured.length = 0;
      delete env.FACE_EMERGENCY_DISABLE;
      env.FACE_MATCH_PROVIDER = "aws_rekognition_faces";
      // Only meaningful when AWS is configured (creds + collection).
      const { awsRekognitionConfigured } = await import("../src/lib/services/aws-rekognition");
      if (!awsRekognitionConfigured()) {
        console.log("      (skipped - AWS not configured in this env)");
        return;
      }
      env.AWS_REGION = "eu-central-1"; // disagrees with AWS_REKOGNITION_REGION
      const fired = await evaluateVerificationAlerts();
      assert.ok(fired.includes("region_mismatch"), "region_mismatch fired");
      assert.ok(captured.some((x) => x.kind === "region_mismatch"));
    });

    await check("raiseOpsAlert failure is tolerated (channel throws, no crash)", async () => {
      setExternalAlertTransport(async () => {
        throw new Error("down");
      });
      // Must not throw even though the channel is broken.
      await raiseOpsAlert("provider_down", "test detail with counts only (12/60)");
    });
  } finally {
    setExternalAlertTransport(null);
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
    // Tidy the ops_alert audit rows this test created.
    await db.verificationAuditEvent
      .deleteMany({
        where: { eventType: "ops_alert", createdAt: { gte: new Date(Date.now() - 600000) } },
      })
      .catch(() => {});
    await db.$disconnect();
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
