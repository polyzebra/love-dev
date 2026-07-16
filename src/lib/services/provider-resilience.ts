import { db } from "@/lib/db";
import { recordProviderFailure, recordProviderSuccess } from "@/lib/services/moderation-providers";

/**
 * Provider health & resilience (Phase 11) - shared by ALL verification
 * providers (stripe_identity, face_match:*), reusing the EXISTING
 * ProviderHealth table + recorders that already back the moderation
 * chain. No parallel health store.
 *
 * Exposed state is exactly four values: HEALTHY / DEGRADED /
 * UNAVAILABLE / UNKNOWN - raw counters stay in the admin read model.
 *
 * Failure classes are normalized from error text (timeout, credential,
 * throttle, quota, network, regional, unknown) so alerting and the
 * runbooks can speak one language regardless of vendor.
 *
 * Circuit breaker: UNAVAILABLE opens the circuit; after the cool-down
 * one half-open probe is allowed through - success closes, failure
 * re-opens. Callers NEVER auto-reject on provider trouble: the
 * face-verification run parks jobs (QUEUED) and the dead-letter sweep
 * escalates long-stuck jobs to MANUAL_REVIEW + an ops alert.
 */

export type ProviderHealthState = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";

export type FailureClass =
  "timeout" | "credential" | "throttle" | "quota" | "network" | "regional" | "unknown";

function num(env: string | undefined, fallback: number): number {
  const v = Number(env);
  return Number.isFinite(v) ? v : fallback;
}

export function resilienceConfig() {
  return {
    /** consecutive failures at which a provider reads DEGRADED. */
    degradedAt: num(process.env.PROVIDER_DEGRADED_AT, 3),
    /** consecutive failures at which the circuit OPENS (UNAVAILABLE). */
    unavailableAt: num(process.env.PROVIDER_UNAVAILABLE_AT, 8),
    /** ms after the last error before a half-open probe is allowed. */
    cooldownMs: num(process.env.PROVIDER_BREAKER_COOLDOWN_MS, 5 * 60_000),
    /** errors older than this decay: the provider reads HEALTHY again. */
    errorTtlMs: num(process.env.PROVIDER_ERROR_TTL_MS, 30 * 60_000),
    /** retry attempts inside withResilience. */
    retries: num(process.env.PROVIDER_RETRIES, 2),
    /** exponential backoff base (delay = base * 2^attempt). */
    backoffBaseMs: num(process.env.PROVIDER_BACKOFF_BASE_MS, 250),
    /** per-attempt timeout. */
    timeoutMs: num(process.env.PROVIDER_TIMEOUT_MS, 10_000),
    /** face_check_error audits within 24h that dead-letter a job. */
    deadLetterAfterErrors: num(process.env.FACE_DEAD_LETTER_ERRORS, 3),
  };
}

/** Normalize an error into one failure class (never raw vendor text). */
export function classifyProviderFailure(error: unknown): FailureClass {
  const text = (
    error instanceof Error ? `${error.name} ${error.message}` : String(error)
  ).toLowerCase();
  if (/timeout|timed out|aborted|deadline/.test(text)) return "timeout";
  if (/credential|unauthorized|forbidden|invalid.*key|expired.*token|signature/.test(text)) {
    return "credential";
  }
  if (/throttl|rate.?limit|too many requests|429/.test(text)) return "throttle";
  if (/quota|limit exceeded|insufficient capacity/.test(text)) return "quota";
  if (/network|econn|enotfound|socket|fetch failed|dns/.test(text)) return "network";
  if (/region|unavailable in|not available in/.test(text)) return "regional";
  return "unknown";
}

/** Derive the four-value state from the shared ProviderHealth row. */
export async function providerHealthState(provider: string): Promise<ProviderHealthState> {
  const cfg = resilienceConfig();
  const row = await db.providerHealth
    .findUnique({
      where: { provider },
      select: { consecutiveFailures: true, lastErrorAt: true, lastSuccessAt: true },
    })
    .catch(() => null);
  if (!row || (!row.lastErrorAt && !row.lastSuccessAt)) return "UNKNOWN";
  const errorFresh = row.lastErrorAt && Date.now() - row.lastErrorAt.getTime() < cfg.errorTtlMs;
  if (!errorFresh) return "HEALTHY";
  if (row.consecutiveFailures >= cfg.unavailableAt) return "UNAVAILABLE";
  if (row.consecutiveFailures >= cfg.degradedAt) return "DEGRADED";
  return "HEALTHY";
}

/**
 * Circuit check. OPEN (true) while UNAVAILABLE and inside the cool-down;
 * after the cool-down one half-open probe passes (callers go through
 * withResilience, whose outcome closes or re-opens the circuit).
 */
export async function circuitOpen(provider: string): Promise<boolean> {
  const cfg = resilienceConfig();
  const row = await db.providerHealth
    .findUnique({
      where: { provider },
      select: { consecutiveFailures: true, lastErrorAt: true },
    })
    .catch(() => null);
  if (!row || row.consecutiveFailures < cfg.unavailableAt) return false;
  const sinceError = row.lastErrorAt ? Date.now() - row.lastErrorAt.getTime() : Infinity;
  return sinceError < cfg.cooldownMs; // past cool-down -> half-open probe
}

/** Injectable sleeper so tests never wait on real backoff. */
let sleeper: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
export function setResilienceSleeper(fn: ((ms: number) => Promise<void>) | null): void {
  sleeper = fn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
}

export class ProviderCircuitOpenError extends Error {
  readonly code = "provider_circuit_open";
  constructor(provider: string) {
    super(`Provider ${provider} circuit is open (cooling down).`);
    this.name = "ProviderCircuitOpenError";
  }
}

/**
 * Execute one provider operation with timeout, retries (exponential
 * backoff), health recording and the circuit breaker. The LAST error is
 * rethrown after retries so callers keep their fail-safe behavior
 * (face runs park the job; nothing is ever granted or rejected here).
 */
export async function withResilience<T>(
  provider: string,
  operation: () => Promise<T>,
  opts: { retries?: number; timeoutMs?: number } = {},
): Promise<T> {
  const cfg = resilienceConfig();
  const retries = opts.retries ?? cfg.retries;
  const timeoutMs = opts.timeoutMs ?? cfg.timeoutMs;

  if (await circuitOpen(provider)) throw new ProviderCircuitOpenError(provider);

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleeper(cfg.backoffBaseMs * 2 ** (attempt - 1));
    try {
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
      await recordProviderSuccess(provider);
      return result;
    } catch (error) {
      lastError = error;
      const failureClass = classifyProviderFailure(error);
      await recordProviderFailure(provider, `${failureClass}: provider operation failed`);
      // Credential failures never self-heal - retrying burns quota/noise.
      if (failureClass === "credential") break;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Ops alerts - notify staff through the EXISTING notification outbox
// ---------------------------------------------------------------------------

export type AlertSeverity = "critical" | "high" | "warning";

/** Severity + escalation policy per alert kind (Phase 26). */
export const ALERT_POLICY: Record<string, { severity: AlertSeverity; escalateAfterMin: number }> = {
  provider_down: { severity: "critical", escalateAfterMin: 15 },
  credential_failure: { severity: "critical", escalateAfterMin: 15 },
  quota_exhaustion: { severity: "high", escalateAfterMin: 30 },
  queue_stalled: { severity: "high", escalateAfterMin: 30 },
  face_dead_letter: { severity: "high", escalateAfterMin: 60 },
  rotation_or_run_failures: { severity: "high", escalateAfterMin: 60 },
  verification_spike: { severity: "warning", escalateAfterMin: 120 },
  appeal_spike: { severity: "warning", escalateAfterMin: 120 },
  false_positive_spike: { severity: "high", escalateAfterMin: 60 },
  reference_deletion_failure: { severity: "high", escalateAfterMin: 60 },
  liveness_completion_drop: { severity: "warning", escalateAfterMin: 120 },
  cron_failure: { severity: "high", escalateAfterMin: 30 },
  provider_degraded: { severity: "warning", escalateAfterMin: 120 },
  // Config/state rules (Phase 7): a selected provider with no legal
  // approval, a region-consistency violation, the kill switch being
  // flipped, and abnormal decision rates.
  legal_gate_missing: { severity: "critical", escalateAfterMin: 15 },
  region_mismatch: { severity: "critical", escalateAfterMin: 15 },
  emergency_disable_active: { severity: "high", escalateAfterMin: 30 },
  suspension_spike: { severity: "high", escalateAfterMin: 60 },
  manual_review_spike: { severity: "warning", escalateAfterMin: 120 },
};

type ExternalAlertTransport = (payload: {
  kind: string;
  severity: AlertSeverity;
  detail: string;
  status: "firing" | "resolved";
}) => Promise<boolean>;
let externalAlertTransportOverride: ExternalAlertTransport | null = null;
/** Test seam: inject the external alert transport (null restores). */
export function setExternalAlertTransport(fn: ExternalAlertTransport | null): void {
  externalAlertTransportOverride = fn;
}

/**
 * External channel (Phase 26): a generic JSON webhook (Slack/Discord/
 * PagerDuty/Opsgenie all accept one) - INDEPENDENT of the application
 * notification outbox. Payloads carry kind/severity/status/detail only:
 * detail strings are composed from counts and thresholds, never personal
 * or biometric data. Channel failure is tolerated (recorded, never
 * thrown) and the outbox remains the secondary channel.
 */
async function sendExternalAlert(payload: {
  kind: string;
  severity: AlertSeverity;
  detail: string;
  status: "firing" | "resolved";
}): Promise<boolean> {
  if (externalAlertTransportOverride) {
    // Channel failure is tolerated - the outbox remains the secondary path.
    return externalAlertTransportOverride(payload).catch(() => false);
  }
  const url = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "tirvea-verification",
        ...payload,
        text: `[${payload.severity.toUpperCase()}][${payload.status}] ${payload.kind}: ${payload.detail}`,
        at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Whether an external alert channel is wired (webhook env or an injected
 * transport) - a read-only gate check with NO delivery/side effect. Use
 * this for status views; use sendTestOpsAlert to actually exercise it.
 */
export function isExternalAlertChannelConfigured(): boolean {
  return Boolean(externalAlertTransportOverride || process.env.ALERT_WEBHOOK_URL?.trim());
}

/**
 * Admin/CLI DRY-RUN: deliver a synthetic alert through the EXTERNAL channel
 * ONLY (no admin outbox, no audit) to verify the wiring end to end. Returns
 * whether a channel is configured and whether it accepted the message.
 * Never throws - a channel failure is reported, not raised.
 */
export async function sendTestOpsAlert(
  note = "manual dry-run",
): Promise<{ channelConfigured: boolean; delivered: boolean }> {
  const channelConfigured = isExternalAlertChannelConfigured();
  const delivered = await sendExternalAlert({
    kind: "ops_alert_test",
    severity: "warning",
    detail: `Test alert (${note}) - verifying the external ops channel. No action needed.`,
    status: "firing",
  });
  return { channelConfigured, delivered };
}

export async function raiseOpsAlert(
  kind: string,
  detail: string,
  dedupeSuffix: string = new Date().toISOString().slice(0, 10),
): Promise<void> {
  const policy = ALERT_POLICY[kind] ?? { severity: "warning" as const, escalateAfterMin: 120 };

  // External channel first (primary, independent of the outbox).
  const delivered = await sendExternalAlert({
    kind,
    severity: policy.severity,
    detail,
    status: "firing",
  });

  // Secondary channel: the in-app notification outbox to staff.
  const admins = await db.user.findMany({
    where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } },
    select: { id: true },
    take: 10,
  });
  const { notifyUser } = await import("@/lib/services/notify");
  for (const adminUser of admins) {
    await notifyUser({
      userId: adminUser.id,
      type: "SYSTEM",
      title: `Ops alert [${policy.severity}]: ${kind}`,
      body: detail,
      dedupeKey: `ops-alert:${kind}:${dedupeSuffix}`,
    }).catch(() => undefined);
  }

  // Audit trail: alert state for dedupe/resolved tracking. userId-less
  // events are not supported by the model, so anchor on any admin (the
  // event is operational, not personal). Failure tolerated.
  const anchor = admins[0]?.id;
  if (anchor) {
    const { recordVerificationAudit } = await import("@/lib/services/face-verification");
    await recordVerificationAudit({
      userId: anchor,
      eventType: "ops_alert",
      actorType: "system",
      newStatus: delivered ? "delivered_external" : "outbox_only",
      reasonCode: kind,
    });
  }
}

/**
 * Resolved notifications: called by the alert evaluator when a
 * previously-firing condition is clear. Deduped per kind/day like firing.
 */
export async function resolveOpsAlert(kind: string): Promise<void> {
  const policy = ALERT_POLICY[kind] ?? { severity: "warning" as const, escalateAfterMin: 120 };
  await sendExternalAlert({
    kind,
    severity: policy.severity,
    detail: "condition cleared",
    status: "resolved",
  });
}

/**
 * Dead-letter sweep (cron): QUEUED face jobs that keep failing are
 * escalated to MANUAL_REVIEW - a human decides, the user is never
 * auto-rejected, and the queue never grows unbounded. Returns the
 * number of escalated jobs.
 */
export async function sweepDeadLetterJobs(limit = 20): Promise<number> {
  const cfg = resilienceConfig();
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const stuck = await db.profilePhotoVerification.findMany({
    where: { status: "QUEUED" },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true, userId: true },
  });
  let escalated = 0;
  for (const job of stuck) {
    const errors = await db.verificationAuditEvent.count({
      where: { userId: job.userId, eventType: "face_check_error", createdAt: { gte: since } },
    });
    if (errors < cfg.deadLetterAfterErrors) continue;
    await db.profilePhotoVerification.update({
      where: { id: job.id },
      data: { status: "MANUAL_REVIEW", badgeStatus: "REVIEWING" },
    });
    const { recordVerificationAudit } = await import("@/lib/services/face-verification");
    await recordVerificationAudit({
      userId: job.userId,
      verificationId: job.id,
      eventType: "face_dead_letter",
      actorType: "system",
      previousStatus: "QUEUED",
      newStatus: "MANUAL_REVIEW",
      reasonCode: "provider_failures_exhausted",
    });
    escalated += 1;
  }
  if (escalated > 0) {
    await raiseOpsAlert(
      "face_dead_letter",
      `${escalated} verification job(s) escalated to manual review after repeated provider failures.`,
    );
  }
  return escalated;
}
