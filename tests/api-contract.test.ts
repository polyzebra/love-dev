/**
 * Unit tests for the v1 transport contract (Phase 0D) - envelopes,
 * pagination, idempotency key shape, and the typed client's parsing
 * (with an injected fetch; no network, no DB, no env):
 *   npx tsx tests/api-contract.test.ts
 */
import assert from "node:assert/strict";
import {
  errorEnvelopeSchema,
  ERROR_STATUS,
  pageSchema,
  paginationQuerySchema,
  encodeCursor,
  decodeCursor,
  idempotencyKeySchema,
} from "../src/lib/api-contract";
import { createTirveaClient } from "../src/lib/api-client";
import { z } from "zod";

let passed = 0;
function check(name: string, fn: () => void | Promise<void>): void | Promise<void> {
  const out = fn();
  if (out instanceof Promise)
    return out.then(() => {
      passed += 1;
      console.log(`  ok - ${name}`);
    });
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main() {
  console.log("envelopes");

  check("error envelope requires code+message; fields optional", () => {
    assert.ok(
      errorEnvelopeSchema.safeParse({ error: { code: "not_found", message: "Gone." } }).success,
    );
    assert.ok(
      errorEnvelopeSchema.safeParse({
        error: { code: "validation_error", message: "Fix.", fields: { email: ["Invalid"] } },
      }).success,
    );
    assert.ok(!errorEnvelopeSchema.safeParse({ error: { code: "x" } }).success, "message required");
    assert.ok(!errorEnvelopeSchema.safeParse({ message: "bare" }).success);
  });

  check("error-code registry maps every code to a concrete status", () => {
    for (const [code, status] of Object.entries(ERROR_STATUS)) {
      assert.ok(Number.isInteger(status) && status >= 400 && status <= 599, code);
    }
    assert.equal(ERROR_STATUS.unauthorized, 401);
    assert.equal(ERROR_STATUS.validation_error, 422);
    assert.equal(ERROR_STATUS.rate_limited, 429);
    assert.equal(ERROR_STATUS.internal_error, 500);
  });

  console.log("pagination");

  check("limit is bounded 1..100 with default 20; cursor optional", () => {
    assert.equal(paginationQuerySchema.parse({}).limit, 20);
    assert.equal(paginationQuerySchema.parse({ limit: "50" }).limit, 50);
    assert.ok(!paginationQuerySchema.safeParse({ limit: 0 }).success);
    assert.ok(!paginationQuerySchema.safeParse({ limit: 101 }).success);
  });

  check("page shape: items + nextCursor(null = end)", () => {
    const page = pageSchema(z.object({ id: z.string() }));
    assert.ok(page.safeParse({ items: [{ id: "a" }], nextCursor: "abc" }).success);
    assert.ok(page.safeParse({ items: [], nextCursor: null }).success);
    assert.ok(!page.safeParse({ items: [] }).success, "nextCursor mandatory");
  });

  check("cursors round-trip and reject garbage", () => {
    const c = encodeCursor({ createdAt: "2026-01-01T00:00:00Z", id: "m1" });
    assert.deepEqual(decodeCursor(c), { createdAt: "2026-01-01T00:00:00Z", id: "m1" });
    assert.equal(decodeCursor("!!!not-a-cursor"), null);
  });

  console.log("idempotency");

  check("key shape: 8..128 printable chars", () => {
    assert.ok(idempotencyKeySchema.safeParse("3e6d0e0a-1f").success);
    assert.ok(!idempotencyKeySchema.safeParse("short").success);
    assert.ok(!idempotencyKeySchema.safeParse("bad key with spaces").success);
    assert.ok(!idempotencyKeySchema.safeParse("x".repeat(129)).success);
  });

  console.log("typed client (injected fetch)");

  const calls: { url: string; init: RequestInit }[] = [];
  const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });

  let nextResponse: Response = respond(200, { data: { retryAfter: 30 } });
  const client = createTirveaClient({
    baseUrl: "https://example.test",
    getAccessToken: () => "tok-abc",
    fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return nextResponse;
    }) as typeof fetch,
  });

  await check("targets /api/v1, sends Bearer + Idempotency-Key, parses {data}", async () => {
    nextResponse = respond(200, { data: { retryAfter: 30 } }, { "x-request-id": "req-1" });
    const res = await client.auth.sendEmailCode("a@example.com");
    assert.ok(res.ok && res.data.retryAfter === 30 && res.requestId === "req-1");
    const call = calls.at(-1)!;
    assert.ok(call.url.startsWith("https://example.test/api/v1/auth/email/send"));
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers["authorization"], "Bearer tok-abc");
  });

  await check("error envelopes surface as typed failures, never throws", async () => {
    nextResponse = respond(409, {
      error: { code: "upgrade_pending", message: "A plan change is pending." },
    });
    const res = await client.billing.changePlan("GOLD");
    assert.ok(!res.ok && res.status === 409 && res.error.code === "upgrade_pending");
  });

  await check("schema-mismatched success data reports malformed_response", async () => {
    nextResponse = respond(200, { data: { nonsense: true } });
    const res = await client.billing.changePlanStatus();
    assert.ok(!res.ok && res.error.code === "malformed_response");
  });

  await check("network failure reports network_error with status 0", async () => {
    const failing = createTirveaClient({
      baseUrl: "https://example.test",
      fetch: (async () => {
        throw new Error("boom");
      }) as typeof fetch,
    });
    const res = await failing.push.status();
    assert.ok(!res.ok && res.status === 0 && res.error.code === "network_error");
  });

  await check("idempotency key rides the standard header", async () => {
    nextResponse = respond(201, { data: { id: "m1" } });
    await client.conversations.sendMessage("c1", { body: "hi" }, { idempotencyKey: "k-12345678" });
    const headers = calls.at(-1)!.init.headers as Record<string, string>;
    assert.equal(headers["idempotency-key"], "k-12345678");
  });

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error("\nFAILED:", error);
  process.exitCode = 1;
});
