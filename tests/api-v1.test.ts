/**
 * Live tests for the v1 transport surface (Phase 0D):
 *   npx tsx tests/api-v1.test.ts
 *
 * Live lane: real Supabase credentials + the dev server on :3000
 * (route checks skip with a notice when unreachable). Verifies:
 *  - /api/v1/* rewrite-aliases the same handlers as /api/*
 *  - X-Request-Id is stamped, and honored when well-formed
 *  - auth OTP routes speak the standard envelope (legacy keys mirrored)
 *  - Idempotency-Key on message send: same key replays ONE message,
 *    a different key creates a second one
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const RUN = Date.now().toString(36);
const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}
function skip(name: string, why: string) {
  console.log(`  skip - ${name} (${why})`);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { db } = await import("../src/lib/db");

  const reachable = await fetch(`${BASE}/api/health`).then(
    (r) => r.ok,
    () => false,
  );
  if (!reachable) {
    skip("all v1 route checks", "dev server not running");
    await db.$disconnect();
    console.log(`\n${passed} checks passed`);
    return;
  }

  const password = `v1-test-${RUN}-Aa1!`;
  const mkUser = async (tag: string, phoneTail: string) => {
    const email = `v1-${tag}-${RUN}@example.com`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const uid = created.data.user!.id;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: `V1 ${tag}`,
        emailVerified: now,
        phone: `+3538799${phoneTail}`,
        phoneVerifiedAt: now,
        ageConfirmedAt: now,
        termsVersion: "2026-07",
        privacyVersion: "2026-07",
        communityVersion: "2026-07",
        onboardingDone: true,
      },
    });
    const anon = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const token = (await anon.auth.signInWithPassword({ email, password })).data.session!
      .access_token;
    return { uid, token };
  };

  const a = await mkUser("a", `1${RUN.slice(-4)}`);
  const b = await mkUser("b", `2${RUN.slice(-4)}`);

  // A real matched conversation for the idempotency checks.
  const [userAId, userBId] = [a.uid, b.uid].sort();
  const match = await db.match.create({ data: { userAId, userBId } });
  const conversation = await db.conversation.create({
    data: {
      matchId: match.id,
      participants: { create: [{ userId: a.uid }, { userId: b.uid }] },
    },
  });

  try {
    console.log("v1 surface, live:");

    await check("/api/v1 aliases the same handlers (health parity)", async () => {
      const [legacy, v1] = await Promise.all([
        fetch(`${BASE}/api/health`),
        fetch(`${BASE}/api/v1/health`),
      ]);
      assert.equal(v1.status, legacy.status);
    });

    await check("guarded route via /api/v1 with Bearer -> 200", async () => {
      const res = await fetch(`${BASE}/api/v1/push/status`, {
        headers: { authorization: `Bearer ${a.token}` },
      });
      assert.equal(res.status, 200);
      assert.ok((await res.json()).data !== undefined);
    });

    await check("X-Request-Id is stamped on every API response", async () => {
      const res = await fetch(`${BASE}/api/v1/health`);
      const id = res.headers.get("x-request-id");
      assert.ok(id && id.length >= 8, "generated id present");
    });

    await check("well-formed client X-Request-Id is honored; garbage is replaced", async () => {
      const good = await fetch(`${BASE}/api/v1/health`, {
        headers: { "x-request-id": "client-supplied-123" },
      });
      assert.equal(good.headers.get("x-request-id"), "client-supplied-123");
      const bad = await fetch(`${BASE}/api/v1/health`, {
        headers: { "x-request-id": "bad id with spaces!!" },
      });
      assert.notEqual(bad.headers.get("x-request-id"), "bad id with spaces!!");
    });

    await check("auth OTP send speaks the standard envelope (+ legacy mirrors)", async () => {
      const res = await fetch(`${BASE}/api/v1/auth/email/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: `envelope-${RUN}@example.com` }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        data?: { retryAfter?: number };
        ok?: boolean;
        retryAfter?: number;
      };
      assert.ok(typeof body.data?.retryAfter === "number", "standard envelope data.retryAfter");
      assert.equal(body.ok, true, "legacy ok mirrored during migration");
      assert.equal(body.retryAfter, body.data?.retryAfter, "legacy retryAfter mirrored");
    });

    const send = (key?: string, text = "hello") =>
      fetch(`${BASE}/api/v1/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${a.token}`,
          ...(key ? { "idempotency-key": key } : {}),
        },
        body: JSON.stringify({ body: text }),
      });

    await check("same Idempotency-Key twice -> ONE message, second is a replay", async () => {
      const key = `v1-idem-${RUN}-aaaa`;
      const first = await send(key);
      assert.equal(first.status, 201);
      const firstBody = (await first.json()) as { data: { id: string } };
      const second = await send(key);
      assert.equal(second.status, 201);
      assert.equal(second.headers.get("idempotency-replayed"), "true");
      const secondBody = (await second.json()) as { data: { id: string } };
      assert.equal(secondBody.data.id, firstBody.data.id, "same canonical message");
      const count = await db.message.count({ where: { conversationId: conversation.id } });
      assert.equal(count, 1, "exactly one message row");
    });

    await check("a DIFFERENT key creates a second message", async () => {
      const res = await send(`v1-idem-${RUN}-bbbb`, "second");
      assert.equal(res.status, 201);
      assert.equal(res.headers.get("idempotency-replayed"), null);
      const count = await db.message.count({ where: { conversationId: conversation.id } });
      assert.equal(count, 2);
    });

    await check("malformed Idempotency-Key -> 422 validation_error", async () => {
      const res = await send("bad key");
      assert.equal(res.status, 422);
      const body = (await res.json()) as { error?: { code?: string } };
      assert.equal(body.error?.code, "validation_error");
    });

    await check("no key behaves exactly as before (no dedup)", async () => {
      const before = await db.message.count({ where: { conversationId: conversation.id } });
      await send(undefined, "plain-1");
      await send(undefined, "plain-1");
      const after = await db.message.count({ where: { conversationId: conversation.id } });
      assert.equal(after, before + 2);
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    await db.conversation.delete({ where: { id: conversation.id } }).catch(() => {});
    await db.match.delete({ where: { id: match.id } }).catch(() => {});
    for (const u of [a, b]) {
      await db.user.delete({ where: { id: u.uid } }).catch(() => {});
      await admin.auth.admin.deleteUser(u.uid).catch(() => {});
    }
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("\nFAILED:", error);
  process.exitCode = 1;
});
