/**
 * Critical end-to-end product flows over the v1 API (Phase 0M):
 *   npx tsx tests/critical-flows.test.ts
 *
 * Live lane: real Supabase credentials + the dev server on :3000 (skips
 * with a notice when unreachable). One continuous journey through the
 * flows the platform must never break:
 *   onboarding -> profile completion (canonical scorer) -> discovery ->
 *   swipe -> mutual match (+ conversation + notification) -> chat ->
 *   block (suppresses messaging) -> report -> account deactivation
 *   (soft - no hard deletes).
 *
 * Registration/email/phone verification are covered by the dedicated
 * auth suites (otp-policy, phone-login, notifications); billing,
 * realtime, media, rate limiting and notifications transports have
 * their own suites. This one proves the PRODUCT spine end to end.
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
    skip("all critical-flow checks", "dev server not running");
    await db.$disconnect();
    console.log(`\n${passed} checks passed`);
    return;
  }

  const password = `cf-test-${RUN}-Aa1!`;
  const mkUser = async (tag: string, phoneTail: string) => {
    const email = `cf-${tag}-${RUN}@example.com`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const uid = created.data.user!.id;
    const now = new Date();
    // Auth-funnel state (email+phone verified, consents) is minted
    // directly - the funnel itself is covered by the auth suites.
    await db.user.create({
      data: {
        id: uid,
        email,
        name: `CF ${tag}`,
        emailVerified: now,
        phone: `+3538792${phoneTail}`,
        phoneVerifiedAt: now,
        ageConfirmedAt: now,
        termsVersion: "2026-07",
        privacyVersion: "2026-07",
        communityVersion: "2026-07",
      },
    });
    const anon = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const token = (await anon.auth.signInWithPassword({ email, password })).data.session!
      .access_token;
    return { uid, token };
  };

  const alice = await mkUser("alice", `1${RUN.slice(-4)}`);
  const bob = await mkUser("bob", `2${RUN.slice(-4)}`);

  const api = (token: string, method: string, path: string, body?: unknown): Promise<Response> =>
    fetch(`${BASE}/api/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  const onboardingPayload = (displayName: string, gender: "MAN" | "WOMAN") => ({
    displayName,
    birthDate: "1995-06-15",
    gender,
    interestedIn: [gender === "MAN" ? "WOMAN" : "MAN"],
    relationshipGoal: "LONG_TERM",
    bio: "Sea swims, long walks, longer conversations. Ask me about my coffee order.",
    city: "Dublin",
    country: "IE",
  });

  let conversationId = "";

  try {
    console.log("critical product flows, live:");

    await check("onboarding completes over the API for both users", async () => {
      const a = await api(alice.token, "POST", "/onboarding", onboardingPayload("Alice", "WOMAN"));
      const b = await api(bob.token, "POST", "/onboarding", onboardingPayload("Bob", "MAN"));
      assert.equal(a.status, 201);
      assert.equal(b.status, 201);
    });

    await check("profile completion uses the canonical scorer (bio >= 40 chars)", async () => {
      const profile = await db.profile.findUniqueOrThrow({ where: { userId: alice.uid } });
      // computeCompletion: base 30 + 15 for a real bio; no photos yet.
      assert.ok(profile.completionPct >= 45, `completionPct ${profile.completionPct}`);
    });

    await check("discovery answers with a deck for a fresh member", async () => {
      const res = await api(alice.token, "GET", "/discover");
      assert.equal(res.status, 200);
      const { data } = (await res.json()) as { data: unknown };
      assert.ok(data !== undefined, "standard envelope");
    });

    await check("swipe: LIKE is accepted and is not yet a match", async () => {
      const res = await api(alice.token, "POST", "/swipes", {
        toId: bob.uid,
        action: "LIKE",
      });
      assert.equal(res.status, 200);
      const { data } = (await res.json()) as { data: { matched: boolean } };
      assert.equal(data.matched, false);
    });

    await check("mutual LIKE creates the match and the conversation", async () => {
      const res = await api(bob.token, "POST", "/swipes", { toId: alice.uid, action: "LIKE" });
      assert.equal(res.status, 200);
      const { data } = (await res.json()) as {
        data: { matched: boolean; conversationId?: string };
      };
      assert.equal(data.matched, true);
      assert.ok(data.conversationId, "conversation ready for the first message");
      conversationId = data.conversationId!;
    });

    await check("the match notifies through the canonical outbox", async () => {
      const note = await db.notification.findFirst({
        where: { userId: alice.uid, type: "NEW_MATCH" },
      });
      assert.ok(note, "NEW_MATCH notification row exists");
      const delivery = await db.notificationDelivery.findFirst({
        where: { notificationId: note!.id, channel: "IN_APP" },
      });
      assert.ok(delivery, "outbox delivery recorded");
    });

    await check("first message + reply flow through the conversation", async () => {
      const first = await api(bob.token, "POST", `/conversations/${conversationId}/messages`, {
        body: "You had me at coffee order. What is it?",
      });
      assert.equal(first.status, 201);
      const reply = await api(alice.token, "POST", `/conversations/${conversationId}/messages`, {
        body: "Flat white, extra shot. Obviously.",
      });
      assert.equal(reply.status, 201);
      const count = await db.message.count({ where: { conversationId } });
      assert.equal(count, 2);
    });

    await check("block: suppresses the conversation and further messages", async () => {
      const res = await api(alice.token, "POST", "/blocks", { blockedId: bob.uid });
      assert.ok(res.status === 200 || res.status === 201, `got ${res.status}`);
      const blocked = await api(bob.token, "POST", `/conversations/${conversationId}/messages`, {
        body: "should never send",
      });
      assert.equal(blocked.status, 403, "blocked pair cannot message");
    });

    await check("report: lands in the safety queue", async () => {
      const res = await api(alice.token, "POST", "/reports", {
        reportedId: bob.uid,
        reason: "SPAM",
        details: "Critical-flow test report.",
      });
      assert.ok(res.status === 200 || res.status === 201, `got ${res.status}`);
      const report = await db.report.findFirst({
        where: { reporterId: alice.uid, reportedId: bob.uid },
      });
      assert.ok(report, "report row exists");
    });

    await check("deactivation is SOFT: row kept, access revoked", async () => {
      const res = await api(bob.token, "POST", "/account/delete");
      assert.equal(res.status, 200);
      const row = await db.user.findUnique({ where: { id: bob.uid } });
      assert.equal(row?.status, "DEACTIVATED", "no hard delete");
      assert.ok(row?.deletionRequested, "deletion window stamped");
      // The account keeps API access (reactivation window) but leaves
      // the product: no longer discoverable/swipeable by anyone.
      const swipe = await api(alice.token, "POST", "/swipes", {
        toId: bob.uid,
        action: "PASS",
      });
      assert.equal(swipe.status, 404, "deactivated profiles are gone from discovery");
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    const convo = conversationId
      ? await db.conversation.findUnique({ where: { id: conversationId } })
      : null;
    if (convo) {
      await db.conversation.delete({ where: { id: convo.id } }).catch(() => {});
      if (convo.matchId) {
        await db.match.delete({ where: { id: convo.matchId } }).catch(() => {});
      }
    }
    for (const u of [alice, bob]) {
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
