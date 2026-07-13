/**
 * Unit tests for the distributed rate limiter (Phase 0F):
 *   npx tsx tests/rate-limit.test.ts
 *
 * Pure - no DB, no env, no server. Covers the required matrix:
 * allowed / threshold / blocked / window reset / concurrency / store
 * outage (fail-open AND fail-closed), plus the Upstash wire protocol
 * against an injected fetch and the preset failMode contract.
 */
import assert from "node:assert/strict";
import {
  createRateLimiter,
  FAIL_CLOSED_RETRY_MS,
  MemoryStore,
  RATE_LIMITS,
  UpstashStore,
  type RateLimitStore,
} from "../src/lib/rate-limit";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("limiter semantics (memory store)");

  await check("allowed: requests under the limit pass with correct remaining", async () => {
    const rl = createRateLimiter({ store: new MemoryStore() });
    const first = await rl("swipe:u1", { limit: 3, windowMs: 60_000, failMode: "open" });
    assert.equal(first.ok, true);
    assert.equal(first.remaining, 2);
    assert.equal(first.degraded, undefined);
  });

  await check("threshold: the limit-th request still passes, remaining 0", async () => {
    const rl = createRateLimiter({ store: new MemoryStore() });
    const preset = { limit: 3, windowMs: 60_000, failMode: "open" as const };
    await rl("k:u1", preset);
    await rl("k:u1", preset);
    const third = await rl("k:u1", preset);
    assert.equal(third.ok, true);
    assert.equal(third.remaining, 0);
  });

  await check("blocked: limit+1 is rejected with a future resetAt", async () => {
    const rl = createRateLimiter({ store: new MemoryStore() });
    const preset = { limit: 2, windowMs: 60_000, failMode: "open" as const };
    await rl("k:u1", preset);
    await rl("k:u1", preset);
    const blocked = await rl("k:u1", preset);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.remaining, 0);
    assert.ok(blocked.resetAt > Date.now());
  });

  await check("window reset: the budget refills after windowMs", async () => {
    const rl = createRateLimiter({ store: new MemoryStore() });
    const preset = { limit: 1, windowMs: 40, failMode: "open" as const };
    assert.equal((await rl("k:u1", preset)).ok, true);
    assert.equal((await rl("k:u1", preset)).ok, false);
    await sleep(60);
    assert.equal((await rl("k:u1", preset)).ok, true);
  });

  await check("keys are independent: one principal never consumes another's budget", async () => {
    const rl = createRateLimiter({ store: new MemoryStore() });
    const preset = { limit: 1, windowMs: 60_000, failMode: "open" as const };
    assert.equal((await rl("k:u1", preset)).ok, true);
    assert.equal((await rl("k:u2", preset)).ok, true);
    assert.equal((await rl("other:u1", preset)).ok, true);
  });

  await check("concurrency: 20 parallel hits, limit 10 -> exactly 10 allowed", async () => {
    const rl = createRateLimiter({ store: new MemoryStore() });
    const preset = { limit: 10, windowMs: 60_000, failMode: "open" as const };
    const results = await Promise.all(Array.from({ length: 20 }, () => rl("burst:u1", preset)));
    assert.equal(results.filter((r) => r.ok).length, 10);
  });

  console.log("store outage behaviour");

  class BrokenStore implements RateLimitStore {
    hit(): Promise<never> {
      return Promise.reject(new Error("connection refused"));
    }
  }

  await check("fail-closed: outage REJECTS with a short retry window", async () => {
    const logs: string[] = [];
    const rl = createRateLimiter({ store: new BrokenStore(), log: (m) => logs.push(m) });
    const before = Date.now();
    const res = await rl("billing:u1", { limit: 30, windowMs: 60_000, failMode: "closed" });
    assert.equal(res.ok, false);
    assert.equal(res.degraded, true);
    assert.ok(res.resetAt >= before + FAIL_CLOSED_RETRY_MS - 1000);
    assert.ok(res.resetAt <= before + FAIL_CLOSED_RETRY_MS + 1000);
    assert.equal(logs.length, 1, "outage logged");
    assert.ok(!logs[0].includes("u1"), "principal never reaches logs");
  });

  await check(
    "fail-open: outage falls back to a per-instance floor, never unprotected",
    async () => {
      const rl = createRateLimiter({ store: new BrokenStore(), log: () => {} });
      const preset = { limit: 2, windowMs: 60_000, failMode: "open" as const };
      const a = await rl("msg:u1", preset);
      const b = await rl("msg:u1", preset);
      const c = await rl("msg:u1", preset);
      assert.equal(a.ok, true);
      assert.equal(a.degraded, true);
      assert.equal(b.ok, true);
      assert.equal(c.ok, false, "fallback still enforces the SAME budget");
    },
  );

  await check("outage logging is throttled (no log storm)", async () => {
    const logs: string[] = [];
    const rl = createRateLimiter({ store: new BrokenStore(), log: (m) => logs.push(m) });
    const preset = { limit: 5, windowMs: 60_000, failMode: "open" as const };
    for (let i = 0; i < 10; i += 1) await rl("k:u1", preset);
    assert.equal(logs.length, 1);
  });

  console.log("Upstash wire protocol (injected fetch)");

  const upstashFetch = (
    handler: (body: unknown) => { status?: number; json?: unknown },
  ): { calls: unknown[]; fetch: typeof fetch } => {
    const calls: unknown[] = [];
    const impl = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body);
      const out = handler(body);
      return new Response(JSON.stringify(out.json ?? []), { status: out.status ?? 200 });
    }) as typeof fetch;
    return { calls, fetch: impl };
  };

  await check("sends INCR + PEXPIRE NX + PTTL as one pipeline, parses the reply", async () => {
    const { calls, fetch } = upstashFetch(() => ({
      json: [{ result: 3 }, { result: 0 }, { result: 5000 }],
    }));
    const store = new UpstashStore("https://example.upstash.io", "tok", fetch);
    const before = Date.now();
    const rec = await store.hit("rl:swipe:u1", 60_000);
    assert.equal(rec.count, 3);
    assert.ok(rec.resetAt >= before + 4900 && rec.resetAt <= before + 5200);
    assert.deepEqual(calls[0], [
      ["INCR", "rl:swipe:u1"],
      ["PEXPIRE", "rl:swipe:u1", "60000", "NX"],
      ["PTTL", "rl:swipe:u1"],
    ]);
  });

  await check("HTTP failure, command error and malformed replies all throw", async () => {
    for (const bad of [
      { status: 503 },
      { json: [{ error: "WRONGTYPE" }, { result: 0 }, { result: 10 }] },
      { json: [{ result: "not-a-number" }, { result: 0 }, { result: 10 }] },
    ]) {
      const { fetch } = upstashFetch(() => bad);
      const store = new UpstashStore("https://example.upstash.io", "tok", fetch);
      await assert.rejects(() => store.hit("rl:k", 1000));
    }
  });

  await check("negative PTTL (defensive) still yields a sane resetAt", async () => {
    const { fetch } = upstashFetch(() => ({
      json: [{ result: 1 }, { result: 0 }, { result: -1 }],
    }));
    const store = new UpstashStore("https://example.upstash.io", "tok", fetch);
    const before = Date.now();
    const rec = await store.hit("rl:k", 30_000);
    assert.ok(rec.resetAt >= before + 29_000);
  });

  console.log("preset contract");

  await check("every preset declares an explicit failMode", () => {
    for (const [name, preset] of Object.entries(RATE_LIMITS)) {
      assert.ok(
        preset.failMode === "open" || preset.failMode === "closed",
        `${name} must declare failMode`,
      );
    }
  });

  await check("abuse/billing budgets fail CLOSED; product surfaces fail OPEN", () => {
    assert.equal(RATE_LIMITS.billing.failMode, "closed");
    assert.equal(RATE_LIMITS.report.failMode, "closed");
    assert.equal(RATE_LIMITS.pushTest.failMode, "closed");
    assert.equal(RATE_LIMITS.swipe.failMode, "open");
    assert.equal(RATE_LIMITS.message.failMode, "open");
    assert.equal(RATE_LIMITS.api.failMode, "open");
    assert.equal(RATE_LIMITS.upload.failMode, "open");
    assert.equal(RATE_LIMITS.profileWrite.failMode, "open");
  });

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error("\nFAILED:", error);
  process.exitCode = 1;
});
