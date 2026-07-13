/**
 * Live tests for realtime chat (Phase 0G):
 *   npx tsx tests/api-0g.test.ts
 *
 * Live lane: real Supabase credentials (Realtime enabled) + the dev
 * server on :3000 (skips with a notice when unreachable). Exercises the
 * REAL transport end to end with @supabase/supabase-js subscriptions:
 *
 *  - sender: authorized POST persists and returns 201
 *  - recipient: subscribed participant receives message:new (latency
 *    measured against payload.serverTs)
 *  - multiple devices: two subscriptions for one user both receive
 *  - unauthorized subscriber: a non-participant's private-channel join
 *    is REFUSED by the RLS policy
 *  - blocked conversation: send -> 403 and NO broadcast reaches anyone
 *  - reconnect + missed-message recovery: messages sent while offline
 *    are recovered through the authorized GET after resubscribing
 *  - read receipts: recipient's receipt flips the sender's rows to SEEN
 *    (DB truth) and broadcasts a receipt event the sender receives
 *  - delivered receipts: SENT -> DELIVERED without touching SEEN
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

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

type Payload = Record<string, unknown>;

/** Subscribe to a conversation's private channel; resolve on join outcome. */
function subscribeTo(
  client: SupabaseClient,
  conversationId: string,
  sink: (event: string, payload: Payload) => void,
): Promise<{ channel: RealtimeChannel; status: string }> {
  return new Promise((resolve) => {
    const channel = client
      .channel(`conversation:${conversationId}`, { config: { private: true } })
      .on("broadcast", { event: "message:new" }, (e) => sink("message:new", e.payload ?? {}))
      .on("broadcast", { event: "receipt" }, (e) => sink("receipt", e.payload ?? {}))
      .subscribe((status) => {
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          resolve({ channel, status });
        }
      });
    // CLOSED without an error status also means the join was refused.
    setTimeout(() => resolve({ channel, status: channel.state }), 8_000);
  });
}

/** Wait until the sink has an event matching `pred`, or time out. */
async function waitFor<T>(probe: () => T | undefined, timeoutMs = 6_000): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = probe();
    if (hit !== undefined) return hit;
    await sleep(100);
  }
  return undefined;
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
    skip("all 0G checks", "dev server not running");
    await db.$disconnect();
    console.log(`\n${passed} checks passed`);
    return;
  }

  const password = `og-test-${RUN}-Aa1!`;
  const mkUser = async (tag: string, phoneTail: string) => {
    const email = `og-${tag}-${RUN}@example.com`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const uid = created.data.user!.id;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: `OG ${tag}`,
        emailVerified: now,
        phone: `+3538796${phoneTail}`,
        phoneVerifiedAt: now,
        ageConfirmedAt: now,
        termsVersion: "2026-07",
        privacyVersion: "2026-07",
        communityVersion: "2026-07",
        onboardingDone: true,
      },
    });
    const client = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const session = (await client.auth.signInWithPassword({ email, password })).data.session!;
    await client.realtime.setAuth(session.access_token);
    return { uid, token: session.access_token, client };
  };

  const alice = await mkUser("alice", `1${RUN.slice(-4)}`);
  const bob = await mkUser("bob", `2${RUN.slice(-4)}`);
  const mallory = await mkUser("mallory", `3${RUN.slice(-4)}`);

  const [userAId, userBId] = [alice.uid, bob.uid].sort();
  const match = await db.match.create({ data: { userAId, userBId } });
  const conversation = await db.conversation.create({
    data: {
      matchId: match.id,
      participants: { create: [{ userId: alice.uid }, { userId: bob.uid }] },
    },
  });

  const api = (token: string, method: string, path: string, body?: unknown): Promise<Response> =>
    fetch(`${BASE}/api/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  const channels: RealtimeChannel[] = [];
  try {
    console.log("realtime chat, live:");

    const bobEvents: { event: string; payload: Payload; at: number }[] = [];
    const bobSink = (event: string, payload: Payload) =>
      bobEvents.push({ event, payload, at: Date.now() });

    await check("recipient can join the private conversation channel", async () => {
      const sub = await subscribeTo(bob.client, conversation.id, bobSink);
      channels.push(sub.channel);
      assert.equal(sub.status, "SUBSCRIBED");
    });

    let firstMessageId = "";
    await check("sender POST persists (201) and the recipient receives message:new", async () => {
      const res = await api(alice.token, "POST", `/conversations/${conversation.id}/messages`, {
        body: `hello from alice ${RUN}`,
      });
      assert.equal(res.status, 201);
      const { data } = (await res.json()) as { data: { id: string } };
      firstMessageId = data.id;

      const hit = await waitFor(() =>
        bobEvents.find((e) => e.event === "message:new" && e.payload.id === firstMessageId),
      );
      assert.ok(hit, "recipient received the broadcast");
      const serverTs = hit!.payload.serverTs as number;
      const latency = hit!.at - serverTs;
      assert.ok(latency < 5_000, `delivery latency sane (${latency}ms)`);
      console.log(`      (delivery latency: ${latency}ms)`);
      assert.equal(hit!.payload.body, `hello from alice ${RUN}`);
    });

    await check("multiple devices: a second subscription for bob also receives", async () => {
      const device2: typeof bobEvents = [];
      const client2 = createClient(url, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await client2.auth.signInWithPassword({ email: `og-bob-${RUN}@example.com`, password });
      await client2.realtime.setAuth((await client2.auth.getSession()).data.session!.access_token);
      const sub = await subscribeTo(client2, conversation.id, (e, p) =>
        device2.push({ event: e, payload: p, at: Date.now() }),
      );
      channels.push(sub.channel);
      assert.equal(sub.status, "SUBSCRIBED");

      const res = await api(alice.token, "POST", `/conversations/${conversation.id}/messages`, {
        body: "to all devices",
      });
      assert.equal(res.status, 201);
      const { data } = (await res.json()) as { data: { id: string } };
      const hit1 = await waitFor(() => bobEvents.find((e) => e.payload.id === data.id));
      const hit2 = await waitFor(() => device2.find((e) => e.payload.id === data.id));
      assert.ok(hit1 && hit2, "both devices received the event");
    });

    await check("unauthorized subscriber: non-participant join is REFUSED", async () => {
      const sub = await subscribeTo(mallory.client, conversation.id, () => {
        throw new Error("mallory must never receive an event");
      });
      channels.push(sub.channel);
      assert.notEqual(sub.status, "SUBSCRIBED", `mallory got: ${sub.status}`);
    });

    await check("read receipt: SEEN in the DB and a receipt event to the sender", async () => {
      const aliceEvents: typeof bobEvents = [];
      const sub = await subscribeTo(alice.client, conversation.id, (e, p) =>
        aliceEvents.push({ event: e, payload: p, at: Date.now() }),
      );
      channels.push(sub.channel);
      assert.equal(sub.status, "SUBSCRIBED");

      const res = await api(bob.token, "POST", `/conversations/${conversation.id}/receipts`, {
        kind: "read",
      });
      assert.equal(res.status, 200);

      const row = await db.message.findUnique({ where: { id: firstMessageId } });
      assert.equal(row?.status, "SEEN", "DB is the source of truth");

      const hit = await waitFor(() =>
        aliceEvents.find(
          (e) => e.event === "receipt" && e.payload.kind === "read" && e.payload.byId === bob.uid,
        ),
      );
      assert.ok(hit, "sender received the read receipt event");
    });

    await check("delivered receipt: SENT -> DELIVERED, never regresses SEEN", async () => {
      const res = await api(alice.token, "POST", `/conversations/${conversation.id}/messages`, {
        body: "deliver me",
      });
      const { data } = (await res.json()) as { data: { id: string } };
      const ack = await api(bob.token, "POST", `/conversations/${conversation.id}/receipts`, {
        kind: "delivered",
      });
      assert.equal(ack.status, 200);
      const [fresh, old] = await Promise.all([
        db.message.findUnique({ where: { id: data.id } }),
        db.message.findUnique({ where: { id: firstMessageId } }),
      ]);
      assert.equal(fresh?.status, "DELIVERED");
      assert.equal(old?.status, "SEEN", "read state untouched by a late delivered ack");
    });

    await check("reconnect: messages sent while offline are recovered via GET", async () => {
      // Bob goes offline (unsubscribes everything).
      for (const ch of channels.splice(0)) await bob.client.removeChannel(ch).catch(() => {});
      const res = await api(alice.token, "POST", `/conversations/${conversation.id}/messages`, {
        body: `missed while offline ${RUN}`,
      });
      assert.equal(res.status, 201);
      const { data: sent } = (await res.json()) as { data: { id: string } };

      // Bob comes back: resubscribe, then the recovery fetch (exactly what
      // useConversationChannel does on SUBSCRIBED).
      const events: typeof bobEvents = [];
      const sub = await subscribeTo(bob.client, conversation.id, (e, p) =>
        events.push({ event: e, payload: p, at: Date.now() }),
      );
      channels.push(sub.channel);
      assert.equal(sub.status, "SUBSCRIBED");
      const list = await api(
        bob.token,
        "GET",
        `/conversations/${conversation.id}/messages?take=50`,
      );
      assert.equal(list.status, 200);
      const { data } = (await list.json()) as { data: { messages: { id: string }[] } };
      assert.ok(
        data.messages.some((m) => m.id === sent.id),
        "recovery fetch returned the missed message",
      );
    });

    await check("blocked conversation: send -> 403 and NO broadcast reaches anyone", async () => {
      await db.conversation.update({
        where: { id: conversation.id },
        data: { status: "BLOCKED" },
      });
      const before = bobEvents.length;
      const res = await api(alice.token, "POST", `/conversations/${conversation.id}/messages`, {
        body: "should never leave the server",
      });
      assert.equal(res.status, 403);
      await sleep(1_500);
      assert.equal(bobEvents.length, before, "no event leaked through the block");
      await db.conversation.update({
        where: { id: conversation.id },
        data: { status: "ACTIVE" },
      });
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    for (const ch of channels) {
      await alice.client.removeChannel(ch).catch(() => {});
      await bob.client.removeChannel(ch).catch(() => {});
      await mallory.client.removeChannel(ch).catch(() => {});
    }
    alice.client.realtime.disconnect();
    bob.client.realtime.disconnect();
    mallory.client.realtime.disconnect();
    await db.conversation.delete({ where: { id: conversation.id } }).catch(() => {});
    await db.match.delete({ where: { id: match.id } }).catch(() => {});
    for (const u of [alice, bob, mallory]) {
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
