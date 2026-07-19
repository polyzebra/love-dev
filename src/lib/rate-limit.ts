/**
 * Distributed rate limiter (Phase 0F) - fixed-window counters in a
 * shared store so limits hold across serverless instances, deployments
 * and regions.
 *
 * Store selection (no code change to activate):
 *  - UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN set -> Upstash
 *    Redis over its REST API (fetch-only, no SDK; works in node + edge).
 *  - otherwise -> per-instance memory store (dev/CI; production logs a
 *    one-time warning so the gap is never silent).
 *
 * Failure semantics are explicit PER PRESET (docs/RATE-LIMITING.md):
 *  - failMode "closed": a store outage REJECTS the request (429 with a
 *    short retry). For operations where becoming unprotected is worse
 *    than brief unavailability: billing, reports, OTP budgets.
 *  - failMode "open": a store outage falls back to the per-instance
 *    memory limiter with the SAME budget - degraded (per-instance, not
 *    global) but never unprotected - and the request proceeds if that
 *    floor allows it.
 *  Every outage and every fallback decision is logged (throttled).
 *
 * Keys are `action:principal` where principal is a userId or an IP
 * HASH (never a raw IP - see ipHashFrom in lib/auth/audit.ts). Logs
 * carry only the action segment, never the principal.
 */

type WindowRecord = { count: number; resetAt: number };

export interface RateLimitStore {
  /** Increment the counter for `key`, creating it with `windowMs` TTL. */
  hit(key: string, windowMs: number): Promise<WindowRecord>;
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export class MemoryStore implements RateLimitStore {
  private buckets = new Map<string, WindowRecord>();

  async hit(key: string, windowMs: number): Promise<WindowRecord> {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      // Opportunistic GC to keep the map bounded
      if (this.buckets.size > 10_000) {
        for (const [k, v] of this.buckets) {
          if (v.resetAt <= now) this.buckets.delete(k);
        }
      }
      return { ...fresh };
    }
    existing.count += 1;
    return { ...existing };
  }
}

type UpstashPipelineRow = { result?: unknown; error?: string };

/**
 * Upstash Redis over REST. One pipeline per hit:
 *   INCR key / PEXPIRE key windowMs NX / PTTL key
 * INCR is atomic across instances; PEXPIRE NX means exactly one caller
 * (the first of the window, or the first after a crashed one) sets the
 * TTL, so a counter can never leak without expiry. Throws on transport
 * errors and malformed replies - the caller decides open vs closed.
 */
export class UpstashStore implements RateLimitStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async hit(key: string, windowMs: number): Promise<WindowRecord> {
    const res = await this.fetchImpl(`${this.url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify([
        ["INCR", key],
        ["PEXPIRE", key, String(windowMs), "NX"],
        ["PTTL", key],
      ]),
    });
    if (!res.ok) throw new Error(`rate-limit store responded ${res.status}`);
    const rows = (await res.json()) as UpstashPipelineRow[];
    const failed = rows.find((r) => r.error);
    if (failed) throw new Error(`rate-limit store command failed: ${failed.error}`);
    const count = rows[0]?.result;
    const ttl = rows[2]?.result;
    if (typeof count !== "number" || typeof ttl !== "number") {
      throw new Error("rate-limit store returned a malformed reply");
    }
    // PTTL < 0 should be unreachable (NX above); treat as a fresh window.
    return { count, resetAt: Date.now() + (ttl > 0 ? ttl : windowMs) };
  }
}

// ---------------------------------------------------------------------------
// Limiter
// ---------------------------------------------------------------------------

export type FailMode = "open" | "closed";

export type RateLimitPreset = {
  limit: number;
  windowMs: number;
  /** Explicit store-outage behaviour - see the module docblock. */
  failMode: FailMode;
};

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: number;
  /** True when the shared store was unavailable for this decision. */
  degraded?: boolean;
};

/** How long a fail-closed rejection tells clients to wait. */
export const FAIL_CLOSED_RETRY_MS = 30_000;

/** At most one store-outage warning per interval per process. */
const OUTAGE_LOG_INTERVAL_MS = 30_000;

/** `action:principal` -> `action` (principals never reach logs). */
function actionOf(key: string): string {
  return key.split(":")[0] ?? "unknown";
}

export function createRateLimiter(deps: {
  store: RateLimitStore;
  /** Per-instance floor used when `store` fails and failMode is "open". */
  fallback?: RateLimitStore;
  log?: (message: string) => void;
}) {
  const fallback = deps.fallback ?? new MemoryStore();
  const log = deps.log ?? ((message: string) => console.warn(message));
  let lastOutageLogAt = 0;

  return async function rateLimit(key: string, preset: RateLimitPreset): Promise<RateLimitResult> {
    const { limit, windowMs, failMode } = preset;
    const namespaced = `rl:${key}`;
    try {
      const record = await deps.store.hit(namespaced, windowMs);
      return {
        ok: record.count <= limit,
        remaining: Math.max(0, limit - record.count),
        resetAt: record.resetAt,
      };
    } catch (error) {
      const now = Date.now();
      if (now - lastOutageLogAt >= OUTAGE_LOG_INTERVAL_MS) {
        lastOutageLogAt = now;
        log(
          `[rate-limit] store outage action=${actionOf(key)} failMode=${failMode} ` +
            `error=${String(error).slice(0, 120)}`,
        );
      }
      if (failMode === "closed") {
        // Billing/report/OTP budgets: unprotected is worse than a brief
        // rejection. Deny with a short retry window.
        return { ok: false, remaining: 0, resetAt: now + FAIL_CLOSED_RETRY_MS, degraded: true };
      }
      // Fail-open: enforce the same budget per-instance so the operation
      // is degraded, never unprotected.
      const record = await fallback.hit(namespaced, windowMs);
      return {
        ok: record.count <= limit,
        remaining: Math.max(0, limit - record.count),
        resetAt: record.resetAt,
        degraded: true,
      };
    }
  };
}

function defaultStore(): RateLimitStore {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (url && token) return new UpstashStore(url, token);
  if (process.env.NODE_ENV === "production" && process.env.VERCEL) {
    console.warn(
      "[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN not set - limits are per-instance only. " +
        "Configure the shared store for multi-instance enforcement (docs/RATE-LIMITING.md).",
    );
  }
  return new MemoryStore();
}

// Survive dev-server module reloads exactly like the previous limiter did.
const globalRef = globalThis as unknown as {
  __rateLimit?: ReturnType<typeof createRateLimiter>;
};
export const rateLimit = (globalRef.__rateLimit ??= createRateLimiter({ store: defaultStore() }));

// ---------------------------------------------------------------------------
// Presets - every budget carries an EXPLICIT failMode (docs/RATE-LIMITING.md)
// ---------------------------------------------------------------------------

/**
 * Named presets so every endpoint uses a deliberate budget.
 *
 * Deliberately ABSENT: the OTP/auth funnel. Its limits are DB-backed
 * (lib/auth/rate-limit.ts counts AuthVerificationEvent rows), already
 * distributed across instances, per-identifier AND per-IP-hash, with
 * escalating cooldowns and verify locks - strictly stronger than a
 * counter here. They stay authoritative and untouched (Phase 0F rule).
 */
export const RATE_LIMITS = {
  swipe: { limit: 120, windowMs: 60_000, failMode: "open" },
  message: { limit: 60, windowMs: 60_000, failMode: "open" },
  report: { limit: 10, windowMs: 60 * 60_000, failMode: "closed" },
  api: { limit: 300, windowMs: 60_000, failMode: "open" },
  /** Photo uploads: storage + moderation cost deserves its own budget. */
  upload: { limit: 30, windowMs: 60 * 60_000, failMode: "open" },
  /** Settings/profile/prompts writes - sensitive but user-initiated. */
  profileWrite: { limit: 60, windowMs: 15 * 60_000, failMode: "open" },
  pushSubscribe: { limit: 10, windowMs: 60_000, failMode: "open" },
  pushTest: { limit: 3, windowMs: 60 * 60_000, failMode: "closed" },
  presenceHeartbeat: { limit: 1, windowMs: 10_000, failMode: "open" },
  // Checkout/status/portal share one budget: generous enough for a
  // confirm-page poll, tight enough to blunt session-id probing.
  billing: { limit: 30, windowMs: 60_000, failMode: "closed" },
  // Public contact/support intake: fail CLOSED so a store outage cannot be
  // used to bypass the abuse budget on an unauthenticated write path.
  support: { limit: 5, windowMs: 60 * 60_000, failMode: "closed" },
} as const satisfies Record<string, RateLimitPreset>;
