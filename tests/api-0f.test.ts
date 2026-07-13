/**
 * Live tests for the distributed rate limiting rollout (Phase 0F):
 *   npx tsx tests/api-0f.test.ts
 *
 * Live lane: real Supabase credentials + the dev server on :3000
 * (route checks skip with a notice when unreachable). Verifies the
 * ROUTE-level contract end to end: allowed -> blocked -> window reset
 * on a real guarded endpoint, the standard 429 envelope with retry
 * information, and that budgets are per-principal.
 *
 * The presence heartbeat guard (1 per 10s per user+conversation) sits
 * BEFORE the participant check, so no conversation fixture is needed:
 * within the window the second request must 429 regardless.
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    skip("all 0F route checks", "dev server not running");
    await db.$disconnect();
    console.log(`\n${passed} checks passed`);
    return;
  }

  const password = `of-test-${RUN}-Aa1!`;
  const mkUser = async (tag: string, phoneTail: string) => {
    const email = `of-${tag}-${RUN}@example.com`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const uid = created.data.user!.id;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: `OF ${tag}`,
        emailVerified: now,
        phone: `+3538797${phoneTail}`,
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

  const heartbeat = (token: string, conversationId: string) =>
    fetch(`${BASE}/api/v1/presence/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ conversationId }),
    });

  try {
    console.log("rate limiting, live:");

    const convo = `of-rl-${RUN}`;

    await check("allowed: the first request inside a window passes the guard", async () => {
      const res = await heartbeat(a.token, convo);
      // 403 = passed the rate limit, failed the participant check (the
      // conversation id is synthetic) - exactly what this check needs.
      assert.equal(res.status, 403);
    });

    await check("blocked: the next request inside the window -> 429 envelope", async () => {
      const res = await heartbeat(a.token, convo);
      assert.equal(res.status, 429);
      const body = (await res.json()) as {
        error?: { code?: string; message?: string; retryAfter?: number };
      };
      assert.equal(body.error?.code, "rate_limited");
      assert.ok(body.error?.message, "user-safe message present");
      assert.ok(
        typeof body.error?.retryAfter === "number" && body.error.retryAfter >= 1,
        "retry information in the body",
      );
      const header = Number(res.headers.get("retry-after"));
      assert.ok(header >= 1 && header <= 11, "Retry-After header within the window");
    });

    await check("budgets are per-principal: another user is not affected", async () => {
      const res = await heartbeat(b.token, convo);
      assert.equal(res.status, 403, "user B passes the guard user A exhausted");
    });

    await check("window reset: the budget refills after the window elapses", async () => {
      const blocked = await heartbeat(a.token, convo);
      assert.equal(blocked.status, 429);
      const wait = Number(blocked.headers.get("retry-after"));
      await sleep(Math.min(wait, 11) * 1000 + 500);
      const res = await heartbeat(a.token, convo);
      assert.equal(res.status, 403, "guard passes again after reset");
    });

    console.log(`\n${passed} checks passed`);
  } finally {
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
