/**
 * Live tests for the device / risk / scam engines. Run with:
 *   npx tsx tests/risk-scam-engines.test.ts
 *
 * Talks to the real database from .env. Every row is namespaced under a
 * per-run prefix and removed in `finally`.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";

const RUN = Date.now().toString(36);
const PREFIX = `risk-eng-${RUN}`;
const testEmail = (tag: string) => `${PREFIX}-${tag}@example.com`;

const UA_CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const UA_CHROME_MAC_NEWER =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.100 Safari/537.36";
const UA_FIREFOX_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0";
const UA_SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (Version/17.5 Mobile/15E148 Safari/604.1)";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { sha256Hash } = await import("../src/lib/auth/audit");
  const { parseUserAgent, deviceHashFor, registerDeviceCore } = await import(
    "../src/lib/auth/device"
  );
  const {
    computeRiskScore,
    setIpIntelProvider,
    notConfiguredIpIntel,
    RISK_THRESHOLD,
    RISK_WEIGHTS,
  } = await import("../src/lib/auth/risk");
  const { computeScamScore } = await import("../src/lib/services/scam");
  const { ensureAppUser } = await import("../src/lib/auth/identity");

  const cleanupUserIds: string[] = [];
  const cleanupConversationIds: string[] = [];

  const makeUser = async (tag: string, data: Record<string, unknown> = {}) => {
    const id = randomUUID();
    cleanupUserIds.push(id);
    return db.user.create({
      data: { id, email: testEmail(tag), emailVerified: new Date(), ...data },
    });
  };

  try {
    // ------------------------------------------------------------ device.ts
    console.log("device identity (parser + hash)");
    await check("ua parser buckets browser family + os only", () => {
      assert.deepEqual(parseUserAgent(UA_CHROME_MAC), { uaFamily: "chrome", os: "macos" });
      assert.deepEqual(parseUserAgent(UA_FIREFOX_MAC), { uaFamily: "firefox", os: "macos" });
      assert.deepEqual(parseUserAgent(UA_SAFARI_IOS), { uaFamily: "safari", os: "ios" });
      assert.deepEqual(parseUserAgent(null), { uaFamily: "other", os: "other" });
    });

    const did = randomUUID();
    await check("device hash stable across versions of the same browser", () => {
      assert.equal(deviceHashFor(did, UA_CHROME_MAC), deviceHashFor(did, UA_CHROME_MAC_NEWER));
    });
    await check("device hash rotates on new did or new browser family", () => {
      assert.notEqual(deviceHashFor(did, UA_CHROME_MAC), deviceHashFor(randomUUID(), UA_CHROME_MAC));
      assert.notEqual(deviceHashFor(did, UA_CHROME_MAC), deviceHashFor(did, UA_FIREFOX_MAC));
    });
    await check("device hash is salted, never the raw did", () => {
      const hash = deviceHashFor(did, UA_CHROME_MAC);
      assert.equal(hash.length, 64);
      assert.ok(!hash.includes(did));
    });

    console.log("device registration (live)");
    const devUser = await makeUser("device");
    const first = await registerDeviceCore(devUser.id, did, UA_CHROME_MAC);
    await check("first registration -> new device, count 1, user synced", async () => {
      assert.equal(first.isNewDevice, true);
      assert.equal(first.deviceCount, 1);
      const row = await db.device.findUnique({
        where: { userId_fingerprint: { userId: devUser.id, fingerprint: first.deviceHash } },
      });
      assert.ok(row);
      assert.equal(row.userAgent, "chrome"); // coarse bucket, not the raw UA
      assert.equal(row.platform, "macos");
      assert.equal(row.ip, null); // never a raw ip
      const u = await db.user.findUniqueOrThrow({ where: { id: devUser.id } });
      assert.equal(u.lastDeviceHash, first.deviceHash);
      assert.equal(u.deviceCount, 1);
    });
    await check("same did + browser version bump -> same device", async () => {
      const again = await registerDeviceCore(devUser.id, did, UA_CHROME_MAC_NEWER);
      assert.equal(again.isNewDevice, false);
      assert.equal(again.deviceHash, first.deviceHash);
      assert.equal(again.deviceCount, 1);
    });
    await check("new did -> second distinct device, count synced to 2", async () => {
      const other = await registerDeviceCore(devUser.id, randomUUID(), UA_SAFARI_IOS);
      assert.equal(other.isNewDevice, true);
      assert.equal(other.deviceCount, 2);
      const u = await db.user.findUniqueOrThrow({ where: { id: devUser.id } });
      assert.equal(u.deviceCount, 2);
      assert.equal(u.lastDeviceHash, other.deviceHash);
    });

    // -------------------------------------------------------------- risk.ts
    console.log("risk matrix (live)");
    const ipA = sha256Hash("203.0.113.10");
    const ipB = sha256Hash("203.0.113.20");

    const riskUser = await makeUser("risk", { lastLoginIpHash: ipA });
    const knownDid = randomUUID();
    const known = await registerDeviceCore(riskUser.id, knownDid, UA_CHROME_MAC);

    await check("baseline: known device, same ip -> score 0, intel blind spot noted", async () => {
      const r = await computeRiskScore(riskUser, { ipHash: ipA, deviceHash: known.deviceHash });
      assert.equal(r.score, 0);
      assert.equal(r.highRisk, false);
      assert.deepEqual(r.reasons, ["ip-intel:unavailable"]);
      const u = await db.user.findUniqueOrThrow({ where: { id: riskUser.id } });
      assert.equal(u.riskScore, 0);
      assert.equal(u.riskReason, "ip-intel:unavailable");
      assert.ok(u.riskUpdatedAt && Date.now() - u.riskUpdatedAt.getTime() < 10_000);
    });

    await check("new device alone -> +25 (queried from Device table)", async () => {
      const strangeHash = deviceHashFor(randomUUID(), UA_FIREFOX_MAC);
      const r = await computeRiskScore(riskUser, { ipHash: ipA, deviceHash: strangeHash });
      assert.equal(r.score, RISK_WEIGHTS.new_device);
      assert.ok(r.reasons.includes("new_device"));
      assert.equal(r.highRisk, false); // 25 < 40
    });

    await check("ip change alone -> +15", async () => {
      const r = await computeRiskScore(riskUser, { ipHash: ipB, deviceHash: known.deviceHash });
      assert.equal(r.score, RISK_WEIGHTS.ip_changed);
      assert.deepEqual(r.reasons, ["ip_changed", "ip-intel:unavailable"]);
    });

    await check("new device + ip change -> 40 = high risk threshold", async () => {
      const r = await computeRiskScore(riskUser, {
        ipHash: ipB,
        deviceHash: deviceHashFor(randomUUID(), UA_SAFARI_IOS),
        newDevice: true, // as the verify route passes it
      });
      assert.equal(r.score, 40);
      assert.equal(RISK_THRESHOLD, 40);
      assert.equal(r.highRisk, true);
    });

    await check("disposable email domain -> +20", async () => {
      const dispUser = await makeUser("disp", { email: `${PREFIX}-disp@mailinator.com` });
      const r = await computeRiskScore(dispUser, { ipHash: null, deviceHash: null });
      assert.equal(r.score, RISK_WEIGHTS.disposable_email);
      assert.ok(r.reasons.includes("disposable_email"));
    });

    await check("otp fails last hour: 3 -> +15, 6 -> +30 (tiers replace)", async () => {
      for (let i = 0; i < 3; i++) {
        await db.authVerificationEvent.create({
          data: { type: "otp_verify_fail", email: riskUser.email, userId: riskUser.id },
        });
      }
      const three = await computeRiskScore(riskUser, { ipHash: ipA, deviceHash: known.deviceHash });
      assert.equal(three.score, RISK_WEIGHTS.otp_fails_3plus);
      assert.ok(three.reasons.includes("otp_fails_3plus"));
      for (let i = 0; i < 3; i++) {
        await db.authVerificationEvent.create({
          data: { type: "otp_verify_fail", email: riskUser.email, userId: riskUser.id },
        });
      }
      const six = await computeRiskScore(riskUser, { ipHash: ipA, deviceHash: known.deviceHash });
      assert.equal(six.score, RISK_WEIGHTS.otp_fails_6plus);
      assert.ok(six.reasons.includes("otp_fails_6plus"));
      assert.ok(!six.reasons.includes("otp_fails_3plus"));
      await db.authVerificationEvent.deleteMany({ where: { email: riskUser.email } });
    });

    await check("send velocity: >=3 email_otp_send last hour -> +10", async () => {
      for (let i = 0; i < 3; i++) {
        await db.authVerificationEvent.create({
          data: { type: "email_otp_send", email: riskUser.email },
        });
      }
      const r = await computeRiskScore(riskUser, { ipHash: ipA, deviceHash: known.deviceHash });
      assert.equal(r.score, RISK_WEIGHTS.otp_send_velocity);
      assert.ok(r.reasons.includes("otp_send_velocity"));
      await db.authVerificationEvent.deleteMany({ where: { email: riskUser.email } });
    });

    await check("lifted ban (banReason kept, bannedAt cleared) -> +20", async () => {
      const exBanned = await makeUser("exban", { bannedAt: null, banReason: "spam wave 2025" });
      const r = await computeRiskScore(exBanned, { ipHash: null, deviceHash: null });
      assert.equal(r.score, RISK_WEIGHTS.previously_banned);
      assert.ok(r.reasons.includes("previously_banned"));
    });

    await check("admin flag -> +40 and the flag survives re-evaluation", async () => {
      const flagged = await makeUser("flagged", { riskReason: "admin:romance-scam pattern" });
      const r = await computeRiskScore(flagged, { ipHash: null, deviceHash: null });
      assert.equal(r.score, RISK_WEIGHTS.admin_flagged);
      assert.equal(r.highRisk, true);
      assert.equal(r.reasons[0], "admin:romance-scam pattern");
      const u1 = await db.user.findUniqueOrThrow({ where: { id: flagged.id } });
      assert.ok(u1.riskReason?.startsWith("admin:"));
      // second evaluation reads the persisted reason and keeps the flag
      const r2 = await computeRiskScore(u1, { ipHash: null, deviceHash: null });
      assert.equal(r2.score, RISK_WEIGHTS.admin_flagged);
      assert.equal(r2.reasons[0], "admin:romance-scam pattern");
    });

    await check("combined signals cap at 100", async () => {
      const worst = await makeUser("worst", {
        email: `${PREFIX}-worst@mailinator.com`,
        banReason: "was banned",
        riskReason: "admin:repeat offender",
        lastLoginIpHash: ipA,
      });
      for (let i = 0; i < 6; i++) {
        await db.authVerificationEvent.create({
          data: { type: "otp_verify_fail", email: worst.email, userId: worst.id },
        });
      }
      // admin 40 + new device 25 + ip 15 + disposable 20 + fails 30 + banned 20 = 150
      const r = await computeRiskScore(worst, {
        ipHash: ipB,
        deviceHash: deviceHashFor(randomUUID(), UA_CHROME_MAC),
      });
      assert.equal(r.score, 100);
      assert.equal(r.highRisk, true);
      await db.authVerificationEvent.deleteMany({ where: { email: worst.email } });
    });

    await check("configured ip-intel provider adds vpn/tor and geo persists", async () => {
      setIpIntelProvider({
        name: "test-intel",
        configured: true,
        lookup: async () => ({ vpn: true, tor: false, asn: "AS64500", country: "IE" }),
      });
      try {
        const r = await computeRiskScore(riskUser, {
          ipHash: ipA,
          deviceHash: known.deviceHash,
          rawIp: "203.0.113.10",
        });
        assert.equal(r.score, RISK_WEIGHTS["ip-intel:vpn"]);
        assert.ok(r.reasons.includes("ip-intel:vpn"));
        assert.ok(!r.reasons.includes("ip-intel:unavailable"));
        const u = await db.user.findUniqueOrThrow({ where: { id: riskUser.id } });
        assert.equal(u.lastIpCountry, "IE");
        assert.equal(u.lastIpAsn, "AS64500");
      } finally {
        setIpIntelProvider(notConfiguredIpIntel);
      }
    });

    // ------------------------------------------- previousIpHash rotation
    console.log("previousIpHash rotation (live, ensureAppUser path)");
    const rotUid = randomUUID();
    cleanupUserIds.push(rotUid);
    const rotEmail = testEmail("rotate");
    const supaUser = {
      id: rotUid,
      email: rotEmail,
      email_confirmed_at: new Date().toISOString(),
      app_metadata: { provider: "email" },
      user_metadata: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const fakeReq = (ip: string) =>
      new Request("http://test.local/api", {
        headers: { "x-forwarded-for": ip, "user-agent": UA_CHROME_MAC },
      });

    await ensureAppUser(supaUser, { req: fakeReq("198.51.100.1") });
    const second = await ensureAppUser(supaUser, { req: fakeReq("198.51.100.2") });
    await check("previousIpHash <- old lastLoginIpHash before overwrite", async () => {
      assert.equal(second.ok, true);
      if (!second.ok) return;
      // the verify route persists exactly this rotation:
      await db.user.update({
        where: { id: rotUid },
        data: { previousIpHash: second.previousLoginIpHash },
      });
      const u = await db.user.findUniqueOrThrow({ where: { id: rotUid } });
      assert.equal(u.previousIpHash, sha256Hash("198.51.100.1"));
      assert.equal(u.lastLoginIpHash, sha256Hash("198.51.100.2"));
    });
    const third = await ensureAppUser(supaUser, { req: fakeReq("198.51.100.3") });
    await check("next login rotates again", async () => {
      assert.equal(third.ok, true);
      if (!third.ok) return;
      await db.user.update({
        where: { id: rotUid },
        data: { previousIpHash: third.previousLoginIpHash },
      });
      const u = await db.user.findUniqueOrThrow({ where: { id: rotUid } });
      assert.equal(u.previousIpHash, sha256Hash("198.51.100.2"));
      assert.equal(u.lastLoginIpHash, sha256Hash("198.51.100.3"));
    });

    // -------------------------------------------------------------- scam.ts
    console.log("scam engine (live, seeded behaviour)");
    const scammer = await makeUser("scammer");

    await check("clean user -> score 0", async () => {
      const r = await computeScamScore(scammer.id);
      assert.equal(r.score, 0);
      assert.deepEqual(r.reasons, []);
    });

    // 150 like targets
    const targetIds = Array.from({ length: 150 }, () => randomUUID());
    cleanupUserIds.push(...targetIds);
    await db.user.createMany({
      data: targetIds.map((id, i) => ({ id, email: testEmail(`target-${i}`) })),
    });
    await db.like.createMany({
      data: targetIds.slice(0, 80).map((toId) => ({
        fromId: scammer.id,
        toId,
        action: "LIKE" as const,
      })),
    });
    await check("80 likes/24h -> +20", async () => {
      const r = await computeScamScore(scammer.id);
      assert.equal(r.score, 20);
      assert.deepEqual(r.reasons, ["likes_24h_80plus"]);
    });
    await db.like.createMany({
      data: targetIds.slice(80).map((toId) => ({
        fromId: scammer.id,
        toId,
        action: "LIKE" as const,
      })),
    });
    await check("150 likes/24h -> +40 tier replaces +20", async () => {
      const r = await computeScamScore(scammer.id);
      assert.equal(r.score, 40);
      assert.deepEqual(r.reasons, ["likes_24h_150plus"]);
    });

    // identical body to 5 distinct conversations
    const convoRows = await Promise.all(
      Array.from({ length: 5 }, () => db.conversation.create({ data: {} })),
    );
    cleanupConversationIds.push(...convoRows.map((c) => c.id));
    await db.message.createMany({
      data: convoRows.map((c) => ({
        conversationId: c.id,
        senderId: scammer.id,
        body: "hey beautiful, I am an investor - message me on telegram",
      })),
    });
    await check("identical body to 5 conversations/7d -> +25", async () => {
      const r = await computeScamScore(scammer.id);
      assert.equal(r.score, 65);
      assert.ok(r.reasons.includes("copy_paste_messages"));
    });

    // link spam (distinct bodies so only the link signal fires)
    await db.message.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        conversationId: convoRows[0].id,
        senderId: scammer.id,
        body: `great returns here http://totally-legit.example/${i}`,
      })),
    });
    await check(">=5 link messages/7d -> +15", async () => {
      const r = await computeScamScore(scammer.id);
      assert.equal(r.score, 80);
      assert.ok(r.reasons.includes("link_messages"));
    });

    // 100 messages in 24h (10 already sent above)
    await db.message.createMany({
      data: Array.from({ length: 90 }, (_, i) => ({
        conversationId: convoRows[i % 5].id,
        senderId: scammer.id,
        body: `filler ${i}`,
      })),
    });
    await check(">=100 messages/24h -> +20 (score now capped at 100)", async () => {
      const r = await computeScamScore(scammer.id);
      assert.equal(r.score, 100);
      assert.ok(r.reasons.includes("messages_24h_100plus"));
      const u = await db.user.findUniqueOrThrow({ where: { id: scammer.id } });
      assert.equal(u.scamScore, 100); // persisted
    });

    await check("reports +10 each capped at +30; blocks 3/30d -> +15", async () => {
      const victim = await makeUser("victim");
      await db.report.createMany({
        data: [
          { reporterId: targetIds[0], reportedId: victim.id, reason: "SCAM" as const, status: "OPEN" as const },
          { reporterId: targetIds[1], reportedId: victim.id, reason: "SPAM" as const, status: "ACTION_TAKEN" as const },
          { reporterId: targetIds[2], reportedId: victim.id, reason: "SCAM" as const, status: "OPEN" as const },
          { reporterId: targetIds[3], reportedId: victim.id, reason: "SCAM" as const, status: "OPEN" as const },
          // DISMISSED must not count
          { reporterId: targetIds[4], reportedId: victim.id, reason: "OTHER" as const, status: "DISMISSED" as const },
        ],
      });
      const reported = await computeScamScore(victim.id);
      assert.equal(reported.score, 30); // 4 x 10 capped at 30
      assert.deepEqual(reported.reasons, ["reports_received_x4"]);
      await db.block.createMany({
        data: [0, 1, 2].map((i) => ({ blockerId: targetIds[i], blockedId: victim.id })),
      });
      const blocked = await computeScamScore(victim.id);
      assert.equal(blocked.score, 45);
      assert.ok(blocked.reasons.includes("blocks_30d_3plus"));
    });

    await check("disposable email -> +10", async () => {
      const disp = await makeUser("scam-disp", { email: `${PREFIX}-scam-disp@yopmail.com` });
      const r = await computeScamScore(disp.id);
      assert.equal(r.score, 10);
      assert.deepEqual(r.reasons, ["disposable_email"]);
    });
  } finally {
    // --------------------------------------------------------------- cleanup
    const { db } = await import("../src/lib/db");
    await db.authVerificationEvent.deleteMany({ where: { email: { contains: PREFIX } } });
    await db.conversation.deleteMany({ where: { id: { in: cleanupConversationIds } } });
    // users cascade: devices, likes, messages, reports, blocks
    await db.user.deleteMany({
      where: { OR: [{ id: { in: cleanupUserIds } }, { email: { contains: PREFIX } }] },
    });
    await db.$disconnect();
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error("\nTEST FAILURE:", error);
  process.exit(1);
});
