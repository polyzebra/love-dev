/**
 * Sliding-window rate limiter.
 *
 * Default store is in-memory (fine for a single instance / dev). In
 * production behind multiple instances, swap the store for Redis
 * (e.g. Upstash) - the interface is deliberately tiny.
 */

type WindowRecord = { count: number; resetAt: number };

export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<WindowRecord>;
}

class MemoryStore implements RateLimitStore {
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
      return fresh;
    }
    existing.count += 1;
    return existing;
  }
}

const globalStore = globalThis as unknown as { __rateLimitStore?: RateLimitStore };
const store: RateLimitStore = (globalStore.__rateLimitStore ??= new MemoryStore());

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: number;
};

export async function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  const record = await store.hit(key, windowMs);
  return {
    ok: record.count <= limit,
    remaining: Math.max(0, limit - record.count),
    resetAt: record.resetAt,
  };
}

/** Named presets so every endpoint uses a deliberate budget. */
export const RATE_LIMITS = {
  login: { limit: 10, windowMs: 15 * 60_000 },
  register: { limit: 5, windowMs: 60 * 60_000 },
  forgotPassword: { limit: 3, windowMs: 15 * 60_000 },
  otp: { limit: 5, windowMs: 10 * 60_000 },
  swipe: { limit: 120, windowMs: 60_000 },
  message: { limit: 60, windowMs: 60_000 },
  report: { limit: 10, windowMs: 60 * 60_000 },
  api: { limit: 300, windowMs: 60_000 },
  pushSubscribe: { limit: 10, windowMs: 60_000 },
  pushTest: { limit: 3, windowMs: 60 * 60_000 },
  presenceHeartbeat: { limit: 1, windowMs: 10_000 },
  // Checkout/status/portal share one budget: generous enough for a
  // confirm-page poll, tight enough to blunt session-id probing.
  billing: { limit: 30, windowMs: 60_000 },
} as const;
