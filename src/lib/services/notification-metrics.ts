import type { NotificationTransport } from "@/generated/prisma/enums";

/**
 * Transport delivery metrics (Phase 0H). In-process counters plus a
 * throttled structured log line - enough to read delivery health off any
 * instance's logs without a metrics vendor, swappable for one later.
 * NEVER receives tokens, endpoints or notification content.
 */

export type TransportCounters = {
  attempted: number;
  delivered: number;
  failed: number;
  invalidToken: number;
  retries: number;
  latencySumMs: number;
  latencyMaxMs: number;
};

const zero = (): TransportCounters => ({
  attempted: 0,
  delivered: 0,
  failed: 0,
  invalidToken: 0,
  retries: 0,
  latencySumMs: 0,
  latencyMaxMs: 0,
});

const counters = new Map<NotificationTransport, TransportCounters>();

const LOG_INTERVAL_MS = 30_000;
let lastLogAt = 0;

export function recordTransportAttempt(input: {
  transport: NotificationTransport;
  outcome: "delivered" | "failed" | "invalid_token";
  latencyMs: number;
  /** True when this send was an outbox retry (attempt > 1). */
  retry: boolean;
}): void {
  const c = counters.get(input.transport) ?? zero();
  c.attempted += 1;
  if (input.outcome === "delivered") c.delivered += 1;
  else if (input.outcome === "invalid_token") c.invalidToken += 1;
  else c.failed += 1;
  if (input.retry) c.retries += 1;
  c.latencySumMs += input.latencyMs;
  c.latencyMaxMs = Math.max(c.latencyMaxMs, input.latencyMs);
  counters.set(input.transport, c);

  const now = Date.now();
  if (now - lastLogAt >= LOG_INTERVAL_MS) {
    lastLogAt = now;
    for (const [transport, totals] of counters) {
      console.info(
        `[notify:metrics] transport=${transport} attempted=${totals.attempted} ` +
          `delivered=${totals.delivered} failed=${totals.failed} ` +
          `invalidToken=${totals.invalidToken} retries=${totals.retries} ` +
          `latencyAvgMs=${totals.attempted ? Math.round(totals.latencySumMs / totals.attempted) : 0} ` +
          `latencyMaxMs=${totals.latencyMaxMs}`,
      );
    }
  }
}

export function getTransportMetrics(): Record<string, TransportCounters> {
  return Object.fromEntries([...counters].map(([k, v]) => [k, { ...v }]));
}

/** Test seam. */
export function resetTransportMetrics(): void {
  counters.clear();
  lastLogAt = 0;
}
