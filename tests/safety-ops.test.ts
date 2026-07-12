/**
 * Live tests for the T&S production ops layer. Run:
 *   npx tsx tests/safety-ops.test.ts
 *
 * Layers:
 *  A. Pure: SLA policy (deadlines, priority derivation, bump, overdue),
 *     workflow stamps, fraud signal units (device reuse, velocity, email
 *     normalization/reuse, verification failures, ip-intel mapping,
 *     impossible travel, fake-profile scoring), ip-intel env resolution.
 *  B. Database (real DB from .env, throwaway rows, cleaned in finally):
 *     case SLA fields on open/dedupe, assignment/claim/unassign races,
 *     overdue escalation, appeal lifecycle (submit -> under_review ->
 *     needs_info -> respond -> decide; withdraw; expire), private
 *     adminNotes never in the user read model, provider fallback chain
 *     with spy providers (induced timeout) + ProviderHealth records,
 *     fraud signals composed into computeTrustProfile.
 * A SPY email provider is injected first - zero real emails.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import type { ModerationProvider } from "../src/lib/services/moderation";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";

const RUN = Date.now().toString(36);
const testEmail = (tag: string) => `safety-ops-${tag}-${RUN}@example.test`;

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { makeSpyEmailProvider, setEmailProviderForTests } = await import(
    "../src/lib/services/email"
  );
  setEmailProviderForTests(makeSpyEmailProvider());

  const {
    CASE_SLA_HOURS,
    priorityForSeverity,
    slaDueAtFor,
    bumpPriority,
    isCaseOverdue,
    caseWorkflowStamps,
    openModerationCase,
    assignCase,
    claimCase,
    unassignCase,
    escalateOverdueCases,
  } = await import("../src/lib/services/trust-safety");
  const {
    submitAppeal,
    reviewAppeal,
    withdrawAppeal,
    markAppealUnderReview,
    requestAppealInfo,
    respondAppealInfo,
    expireStaleNeedsInfo,
    getAccountStatusView,
    listModerationCases,
    AppealError,
    NEEDS_INFO_EXPIRY_DAYS,
  } = await import("../src/lib/services/appeals");
  const {
    deviceReuseSignals,
    velocitySignals,
    normalizeEmailForReuse,
    emailReuseSignals,
    verificationFailureSignals,
    ipIntelSignals,
    detectImpossibleTravel,
    fakeProfileSignals,
    phoneBanSignals,
  } = await import("../src/lib/services/fraud-signals");
  const { buildModerationChain, ModerationChainError, resolveConfiguredProviders } = await import(
    "../src/lib/services/moderation-providers"
  );
  const { externalProvider } = await import("../src/lib/services/moderation");
  const { buildIpIntelProviderFromEnv } = await import("../src/lib/auth/ip-intel");
  const { computeTrustProfile } = await import("../src/lib/services/trust-engine");

  // ------------------------------------------------------------------ A
  console.log("A. pure - SLA policy");

  const T0 = new Date("2026-07-11T00:00:00Z");

  await check("SLA policy: critical 4h, high 24h, medium 72h, low 7d", () => {
    assert.equal(CASE_SLA_HOURS.CRITICAL, 4);
    assert.equal(CASE_SLA_HOURS.HIGH, 24);
    assert.equal(CASE_SLA_HOURS.MEDIUM, 72);
    assert.equal(CASE_SLA_HOURS.LOW, 168);
    assert.equal(slaDueAtFor("CRITICAL", T0).getTime(), T0.getTime() + 4 * 3600_000);
    assert.equal(slaDueAtFor("LOW", T0).getTime(), T0.getTime() + 168 * 3600_000);
  });

  await check("priority derives from severity; bump caps at CRITICAL", () => {
    assert.equal(priorityForSeverity("HIGH"), "HIGH");
    assert.equal(bumpPriority("LOW"), "MEDIUM");
    assert.equal(bumpPriority("HIGH"), "CRITICAL");
    assert.equal(bumpPriority("CRITICAL"), "CRITICAL");
  });

  await check("isCaseOverdue: only unresolved open-ish cases past slaDueAt", () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 3600_000);
    assert.ok(isCaseOverdue({ status: "OPEN", slaDueAt: past, resolvedAt: null }));
    assert.ok(isCaseOverdue({ status: "UNDER_REVIEW", slaDueAt: past, resolvedAt: null }));
    assert.ok(!isCaseOverdue({ status: "OPEN", slaDueAt: future, resolvedAt: null }));
    assert.ok(!isCaseOverdue({ status: "OPEN", slaDueAt: null, resolvedAt: null }));
    assert.ok(!isCaseOverdue({ status: "DISMISSED", slaDueAt: past, resolvedAt: new Date() }));
    assert.ok(!isCaseOverdue({ status: "OPEN", slaDueAt: past, resolvedAt: new Date() }));
  });

  await check("workflow stamps: first response once, resolvedAt on terminal only", () => {
    const now = new Date();
    const fresh = caseWorkflowStamps("under_review", { firstResponseAt: null }, now);
    assert.equal(fresh.firstResponseAt, now);
    assert.equal(fresh.resolvedAt, null);
    const decided = caseWorkflowStamps("take_action", { firstResponseAt: now }, now);
    assert.equal(decided.firstResponseAt, undefined); // never overwritten
    assert.equal(decided.resolvedAt, now);
    const dismissed = caseWorkflowStamps("dismiss", { firstResponseAt: null }, now);
    assert.equal(dismissed.resolvedAt, now);
    assert.equal(dismissed.firstResponseAt, now);
  });

  console.log("A. pure - fraud signal units");

  await check("device reuse tiers", () => {
    assert.deepEqual(deviceReuseSignals(1), []);
    assert.equal(deviceReuseSignals(2)[0].name, "device_multi_account");
    assert.equal(deviceReuseSignals(2)[0].points, 20);
    assert.equal(deviceReuseSignals(4)[0].name, "device_many_accounts_x4");
    assert.equal(deviceReuseSignals(4)[0].points, 30);
  });

  await check("velocity tiers (device signups + ip identities)", () => {
    assert.deepEqual(velocitySignals({ deviceSignups7d: 1, ipIdentities24h: 1 }), []);
    const both = velocitySignals({ deviceSignups7d: 3, ipIdentities24h: 7 });
    assert.equal(both.length, 2);
    assert.ok(both.some((s) => s.name.startsWith("device_signup_velocity") && s.points === 15));
    assert.ok(both.some((s) => s.name === "ip_velocity_x7" && s.points === 20));
    const low = velocitySignals({ deviceSignups7d: 0, ipIdentities24h: 3 });
    assert.equal(low[0].points, 10);
  });

  await check("email normalization: gmail dots + plus tags collapse", () => {
    assert.equal(normalizeEmailForReuse("Jo.hn+spam@GMAIL.com"), "john@gmail.com");
    assert.equal(normalizeEmailForReuse("jo.hn@googlemail.com"), "john@googlemail.com");
    // Dots are significant outside gmail; +tags are not.
    assert.equal(normalizeEmailForReuse("jo.hn+x@proton.me"), "jo.hn@proton.me");
    assert.equal(emailReuseSignals(0).length, 0);
    assert.equal(emailReuseSignals(2)[0].points, 25);
  });

  await check("verification failure tiers", () => {
    assert.deepEqual(verificationFailureSignals({ otpFails7d: 2, rejectedVerifications: 1 }), []);
    const hot = verificationFailureSignals({ otpFails7d: 8, rejectedVerifications: 3 });
    assert.equal(hot.length, 2);
  });

  await check("ip-intel signals only from recorded intel (tor outranks vpn)", () => {
    assert.deepEqual(ipIntelSignals(null), []);
    assert.deepEqual(ipIntelSignals("new_device,ip-intel:unavailable"), []);
    assert.equal(ipIntelSignals("ip-intel:vpn")[0].name, "ip_intel_vpn");
    assert.equal(ipIntelSignals("ip-intel:vpn,ip-intel:tor")[0].name, "ip_intel_tor");
  });

  await check("impossible travel: different countries inside 2h", () => {
    const t = (m: number) => new Date(T0.getTime() + m * 60_000);
    assert.equal(
      detectImpossibleTravel([
        { country: "IE", at: t(0) },
        { country: "AU", at: t(30) },
      ]),
      true,
    );
    assert.equal(
      detectImpossibleTravel([
        { country: "IE", at: t(0) },
        { country: "GB", at: t(300) },
      ]),
      false,
    );
    assert.equal(detectImpossibleTravel([{ country: "IE", at: t(0) }]), false);
  });

  await check("fake-profile scoring: lexicon, contact pattern, hollow shell", () => {
    const scam = fakeProfileSignals({
      bio: "Message me on Telegram for crypto investment opportunity",
      promptAnswers: [],
      photoCount: 3,
      completionPct: 80,
    });
    // "telegram", "crypto" and "investment opportunity" all hit -> x3.
    assert.ok(scam.some((s) => s.name === "fake_profile_lexicon_x3"));
    const contact = fakeProfileSignals({
      bio: "text me +353861234567",
      promptAnswers: [],
      photoCount: 2,
      completionPct: 60,
    });
    assert.ok(contact.some((s) => s.name === "fake_profile_contact"));
    const hollow = fakeProfileSignals({
      bio: null,
      promptAnswers: [],
      photoCount: 0,
      completionPct: 5,
    });
    assert.ok(hollow.some((s) => s.name === "fake_profile_hollow"));
    const clean = fakeProfileSignals({
      bio: "I love hiking and good coffee.",
      promptAnswers: ["Sunday brunch"],
      photoCount: 4,
      completionPct: 90,
    });
    assert.equal(clean.length, 0);
    assert.equal(phoneBanSignals(true)[0].name, "phone_previously_banned");
    assert.equal(phoneBanSignals(false).length, 0);
  });

  await check("ip-intel env resolution: none without key, adapter with key", () => {
    const savedKey = process.env.IP_INTEL_API_KEY;
    const savedProv = process.env.IP_INTEL_PROVIDER;
    try {
      process.env.IP_INTEL_API_KEY = "";
      assert.equal(buildIpIntelProviderFromEnv(), null);
      process.env.IP_INTEL_API_KEY = "test-key";
      process.env.IP_INTEL_PROVIDER = "ipinfo";
      assert.equal(buildIpIntelProviderFromEnv()?.name, "ipinfo");
      process.env.IP_INTEL_PROVIDER = "";
      assert.equal(buildIpIntelProviderFromEnv()?.name, "ipqs");
    } finally {
      process.env.IP_INTEL_API_KEY = savedKey ?? "";
      process.env.IP_INTEL_PROVIDER = savedProv ?? "";
    }
  });

  await check("moderation chain env resolution skips unconfigured providers", () => {
    const saved = {
      list: process.env.MODERATION_PROVIDERS,
      openai: process.env.OPENAI_API_KEY,
      hive: process.env.HIVE_API_KEY,
      gv: process.env.GOOGLE_VISION_API_KEY,
    };
    try {
      process.env.MODERATION_PROVIDERS = "openai,google_vision,hive,bogus";
      process.env.OPENAI_API_KEY = "";
      process.env.HIVE_API_KEY = "";
      process.env.GOOGLE_VISION_API_KEY = "";
      assert.deepEqual(resolveConfiguredProviders(externalProvider), []);
      process.env.OPENAI_API_KEY = "test";
      process.env.GOOGLE_VISION_API_KEY = "test";
      const chain = resolveConfiguredProviders(externalProvider).map((p) => p.name);
      assert.deepEqual(chain, ["openai", "google_vision"]); // order preserved, hive/bogus skipped
    } finally {
      process.env.MODERATION_PROVIDERS = saved.list ?? "";
      process.env.OPENAI_API_KEY = saved.openai ?? "";
      process.env.HIVE_API_KEY = saved.hive ?? "";
      process.env.GOOGLE_VISION_API_KEY = saved.gv ?? "";
    }
  });

  // ------------------------------------------------------------------ B
  console.log("B. live database");

  const userIds: string[] = [];
  const caseIds: string[] = [];
  const makeUser = async (tag: string, data: Record<string, unknown> = {}) => {
    const u = await db.user.create({
      data: { email: testEmail(tag), emailVerified: new Date(), onboardingDone: true, ...data },
    });
    userIds.push(u.id);
    return u;
  };
  const makeViolation = (userId: string) =>
    db.accountViolation.create({
      data: {
        userId,
        violationType: "SPAM",
        actionTaken: "WARNING",
        description: "test violation",
        userVisibleReason: "Something on your profile didn't follow our Community Guidelines.",
        internalReason: `safety-ops test ${RUN}`,
      },
      select: { id: true },
    });

  try {
    // --- SLA fields on open + assignment ---------------------------------
    const subject = await makeUser("case-subject");
    const moderator = await makeUser("moderator", { role: "MODERATOR" });
    const admin = await makeUser("admin", { role: "ADMIN" });
    const civilian = await makeUser("civilian");

    let caseId = "";
    await check("openModerationCase stamps priority + slaDueAt from severity", async () => {
      const opened = await openModerationCase({
        userId: subject.id,
        caseType: "SPAM",
        severity: "HIGH",
        source: "SYSTEM",
        summary: "safety-ops sla test",
      });
      caseId = opened.caseId;
      caseIds.push(caseId);
      const row = await db.moderationCase.findUniqueOrThrow({ where: { id: caseId } });
      assert.equal(row.priority, "HIGH");
      assert.ok(row.slaDueAt);
      const expected = row.createdAt.getTime() + 24 * 3600_000;
      assert.ok(Math.abs(row.slaDueAt!.getTime() - expected) < 5_000);
      assert.equal(row.firstResponseAt, null);
      assert.equal(row.resolvedAt, null);
    });

    await check("severity escalation on dedupe lifts priority too", async () => {
      const merged = await openModerationCase({
        userId: subject.id,
        caseType: "SPAM",
        severity: "CRITICAL",
        source: "SYSTEM",
        summary: "escalating signal",
      });
      assert.equal(merged.caseId, caseId);
      assert.ok(merged.deduped);
      const row = await db.moderationCase.findUniqueOrThrow({ where: { id: caseId } });
      assert.equal(row.severity, "CRITICAL");
      assert.equal(row.priority, "CRITICAL");
    });

    await check("assign requires a staff assignee; stamps firstResponseAt", async () => {
      const bad = await assignCase(caseId, civilian.id);
      assert.deepEqual([bad.ok, !bad.ok && bad.code], [false, "assignee_not_staff"]);
      const good = await assignCase(caseId, moderator.id);
      assert.ok(good.ok);
      const row = await db.moderationCase.findUniqueOrThrow({ where: { id: caseId } });
      assert.equal(row.assignedToId, moderator.id);
      assert.ok(row.firstResponseAt, "assignment counts as first response");
    });

    await check("claim never steals; unassign clears", async () => {
      const steal = await claimCase(caseId, admin.id);
      assert.deepEqual([steal.ok, !steal.ok && steal.code], [false, "already_assigned"]);
      // Re-claim by the current holder is a no-op success.
      const same = await claimCase(caseId, moderator.id);
      assert.ok(same.ok);
      const cleared = await unassignCase(caseId);
      assert.ok(cleared.ok);
      const claimed = await claimCase(caseId, admin.id);
      assert.ok(claimed.ok && claimed.assignedToId === admin.id);
      await unassignCase(caseId);
    });

    await check("overdue unassigned case escalates once + staff notified", async () => {
      // Backdate the deadline and make the case eligible.
      await db.moderationCase.update({
        where: { id: caseId },
        data: {
          slaDueAt: new Date(Date.now() - 3600_000),
          priority: "HIGH",
          escalatedAt: null,
          assignedToId: null,
        },
      });
      await escalateOverdueCases();
      const row = await db.moderationCase.findUniqueOrThrow({ where: { id: caseId } });
      assert.equal(row.priority, "CRITICAL");
      assert.ok(row.escalatedAt);
      // Our staff users got the outbox notification (in-app row exists).
      const delivery = await db.notificationDelivery.findUnique({
        where: { idempotencyKey: `case:${caseId}:sla-escalated:${moderator.id}:in_app` },
      });
      assert.ok(delivery, "moderator notified through the outbox");
      // Second sweep is a no-op (one bump only).
      await escalateOverdueCases();
      const again = await db.moderationCase.findUniqueOrThrow({ where: { id: caseId } });
      assert.equal(again.escalatedAt?.getTime(), row.escalatedAt!.getTime());
    });

    await check("listModerationCases exposes isOverdue + SLA fields", async () => {
      const rows = await listModerationCases({ overdueOnly: true, take: 200 });
      const mine = rows.find((c) => c.id === caseId);
      assert.ok(mine, "overdue filter finds the case");
      assert.equal(mine!.isOverdue, true);
      assert.ok(mine!.slaDueAt && mine!.priority === "CRITICAL");
    });

    // --- appeal lifecycle --------------------------------------------------
    const appellant = await makeUser("appellant");

    await check("appeal: submit -> under_review -> needs_info -> respond -> reject", async () => {
      const violation = await makeViolation(appellant.id);
      const submitted = await submitAppeal({
        userId: appellant.id,
        violationId: violation.id,
        appealText: "This was a misunderstanding, please review it.",
      });
      assert.equal(submitted.status, "SUBMITTED");

      const ur = await markAppealUnderReview({ actorId: admin.id, appealId: submitted.appealId });
      assert.equal(ur.status, "UNDER_REVIEW");

      const ni = await requestAppealInfo({
        actorId: admin.id,
        appealId: submitted.appealId,
        message: "Which photo do you believe was flagged in error?",
      });
      assert.equal(ni.status, "NEEDS_INFO");
      const row = await db.appeal.findUniqueOrThrow({ where: { id: submitted.appealId } });
      assert.ok(row.needsInfoRequestedAt);

      const replied = await respondAppealInfo({
        userId: appellant.id,
        appealId: submitted.appealId,
        message: "The second photo - it is really me.",
      });
      assert.equal(replied.status, "UNDER_REVIEW");
      // One reply per round trip.
      await assert.rejects(
        respondAppealInfo({ userId: appellant.id, appealId: submitted.appealId, message: "more" }),
        (e: unknown) => e instanceof AppealError && e.code === "appeal_not_needs_info",
      );

      // Decision from UNDER_REVIEW works; timeline is complete + ordered.
      const decided = await reviewAppeal({
        actorId: admin.id,
        appealId: submitted.appealId,
        decision: "reject",
        adminNotes: `secret-staff-note-${RUN}`,
      });
      assert.equal(decided.status, "REJECTED");
      const events = await db.appealEvent.findMany({
        where: { appealId: submitted.appealId },
        orderBy: { createdAt: "asc" },
        select: { type: true, actorRole: true },
      });
      assert.deepEqual(
        events.map((e) => e.type),
        ["submitted", "under_review", "needs_info_requested", "user_responded", "rejected"],
      );
      assert.deepEqual(
        events.map((e) => e.actorRole),
        ["USER", "STAFF", "STAFF", "USER", "STAFF"],
      );
    });

    await check("adminNotes never leak into the user read model (asserted on JSON)", async () => {
      const view = await getAccountStatusView(appellant.id);
      assert.ok(view);
      const json = JSON.stringify(view);
      assert.ok(!json.includes(`secret-staff-note-${RUN}`), "adminNotes text leaked");
      assert.ok(!json.includes("adminNotes"), "adminNotes key leaked");
      assert.ok(!json.includes("internalReason"), "internalReason leaked");
      // But the user DOES see the question + their reply on the timeline.
      const appealed = view!.violations.find((v) => v.appeal);
      assert.ok(appealed?.appeal?.timeline.some((t) => t.type === "needs_info_requested"));
      assert.ok(appealed?.appeal?.timeline.some((t) => t.type === "user_responded"));
    });

    await check("withdraw: own pre-decision appeal only; frees a re-appeal", async () => {
      const violation = await makeViolation(appellant.id);
      const first = await submitAppeal({
        userId: appellant.id,
        violationId: violation.id,
        appealText: "Please take another look at this action.",
      });
      // IDOR probe: someone else's session cannot withdraw it (reads 404).
      await assert.rejects(
        withdrawAppeal({ userId: admin.id, appealId: first.appealId }),
        (e: unknown) => e instanceof AppealError && e.code === "appeal_not_found",
      );
      const withdrawn = await withdrawAppeal({ userId: appellant.id, appealId: first.appealId });
      assert.equal(withdrawn.status, "WITHDRAWN");
      // Withdrawn is final for that appeal...
      await assert.rejects(
        withdrawAppeal({ userId: appellant.id, appealId: first.appealId }),
        (e: unknown) => e instanceof AppealError && e.code === "appeal_not_pending",
      );
      // ...but the violation may be appealed afresh.
      const second = await submitAppeal({
        userId: appellant.id,
        violationId: violation.id,
        appealText: "I would like to appeal this after all.",
      });
      assert.notEqual(second.appealId, first.appealId);
      // A decided appeal cannot be withdrawn.
      await reviewAppeal({ actorId: admin.id, appealId: second.appealId, decision: "reject" });
      await assert.rejects(
        withdrawAppeal({ userId: appellant.id, appealId: second.appealId }),
        (e: unknown) => e instanceof AppealError && e.code === "appeal_not_pending",
      );
    });

    await check("stale NEEDS_INFO auto-expires after 14 days; re-appeal allowed", async () => {
      const expiree = await makeUser("expiree");
      const violation = await makeViolation(expiree.id);
      const appeal = await submitAppeal({
        userId: expiree.id,
        violationId: violation.id,
        appealText: "Appealing this decision, thank you.",
      });
      await requestAppealInfo({
        actorId: admin.id,
        appealId: appeal.appealId,
        message: "Could you tell us more?",
      });
      // Not stale yet -> sweep does nothing.
      assert.equal(await expireStaleNeedsInfo({ userId: expiree.id }), 0);
      await db.appeal.update({
        where: { id: appeal.appealId },
        data: {
          needsInfoRequestedAt: new Date(
            Date.now() - (NEEDS_INFO_EXPIRY_DAYS + 1) * 24 * 3600_000,
          ),
        },
      });
      assert.equal(await expireStaleNeedsInfo({ userId: expiree.id }), 1);
      const row = await db.appeal.findUniqueOrThrow({ where: { id: appeal.appealId } });
      assert.equal(row.status, "EXPIRED");
      const events = await db.appealEvent.findMany({ where: { appealId: appeal.appealId } });
      assert.ok(events.some((e) => e.type === "expired" && e.actorRole === "SYSTEM"));
      // The user may appeal the violation again after a system expiry.
      const again = await submitAppeal({
        userId: expiree.id,
        violationId: violation.id,
        appealText: "Sorry for the silence - here is my appeal again.",
      });
      assert.ok(again.appealId);
    });

    // --- provider fallback chain -------------------------------------------
    const chainContext = {
      photoId: `photo-${RUN}`,
      userId: subject.id,
      isCover: false,
      mimeType: "image/webp",
    };
    const chainInput = { buffer: Buffer.from("fake-image-bytes") };
    const okVerdict = {
      decision: "safe" as const,
      aiScore: 0.1,
      faceDetected: true,
      facesCount: 1,
      labels: ["spy"],
    };
    const spyName = (tag: string) => `spy_${tag}_${RUN}`;
    const failing: ModerationProvider = {
      name: spyName("down"),
      async analyze() {
        throw new Error("induced outage");
      },
    };
    const timingOut: ModerationProvider = {
      name: spyName("slow"),
      async analyze() {
        // Induced timeout: the adapter contract is an AbortSignal-bounded
        // call; simulate the abort path deterministically.
        await new Promise((r) => setTimeout(r, 60));
        throw new Error("operation timed out (AbortSignal)");
      },
    };
    const healthy: ModerationProvider = {
      name: spyName("up"),
      async analyze() {
        return okVerdict;
      },
    };

    await check("chain: falls through failures/timeouts to the first healthy provider", async () => {
      const chain = buildModerationChain([failing, timingOut, healthy]);
      const verdict = await chain.analyze(chainInput, chainContext);
      assert.deepEqual(verdict.labels, ["spy"]);
      const downHealth = await db.providerHealth.findUnique({
        where: { provider: failing.name },
      });
      assert.ok(downHealth && downHealth.consecutiveFailures >= 1);
      assert.ok(downHealth!.lastError?.includes("induced outage"));
      const upHealth = await db.providerHealth.findUnique({ where: { provider: healthy.name } });
      assert.ok(upHealth?.lastSuccessAt);
      assert.equal(upHealth!.consecutiveFailures, 0);
    });

    await check("chain: every provider failing throws (FAILED path, never approve)", async () => {
      const chain = buildModerationChain([failing, timingOut]);
      await assert.rejects(
        chain.analyze(chainInput, chainContext),
        (e: unknown) => e instanceof ModerationChainError && e.attempts.length === 2,
      );
      const downHealth = await db.providerHealth.findUniqueOrThrow({
        where: { provider: failing.name },
      });
      assert.ok(downHealth.consecutiveFailures >= 2);
    });

    await check("provider success resets consecutiveFailures", async () => {
      const flaky = buildModerationChain([
        { name: failing.name, analyze: healthy.analyze },
      ]);
      await flaky.analyze(chainInput, chainContext);
      const row = await db.providerHealth.findUniqueOrThrow({ where: { provider: failing.name } });
      assert.equal(row.consecutiveFailures, 0);
      assert.ok(row.totalFailures >= 2, "history preserved");
    });

    // --- fraud signals composed into the trust engine ----------------------
    await check("shared device -> fraud signal lands in computeTrustProfile", async () => {
      const a = await makeUser("device-a");
      const b = await makeUser("device-b");
      const fingerprint = `shared-fp-${RUN}`;
      await db.device.createMany({
        data: [
          { userId: a.id, fingerprint },
          { userId: b.id, fingerprint },
        ],
      });
      const profile = await computeTrustProfile(a.id);
      assert.ok(profile);
      assert.ok(
        profile!.reasons.some((r) => r.startsWith("device_multi_account")),
        `expected device signal, got: ${profile!.reasons.join(",")}`,
      );
    });

    await check("scam-lexicon bio -> fake_profile signals in the composite", async () => {
      const scammer = await makeUser("lexicon");
      await db.profile.create({
        data: {
          userId: scammer.id,
          displayName: "Test",
          birthDate: new Date("1990-01-01"),
          gender: "MAN",
          bio: "DM me on whatsapp +353861234567 for crypto",
          completionPct: 40,
          interestedIn: ["WOMAN"],
        },
      });
      const profile = await computeTrustProfile(scammer.id);
      assert.ok(profile);
      assert.ok(profile!.reasons.some((r) => r.startsWith("fake_profile_lexicon")));
      assert.ok(profile!.reasons.some((r) => r === "fake_profile_contact"));
    });
  } finally {
    setEmailProviderForTests(null);
    // Provider health spy rows.
    await db.providerHealth
      .deleteMany({ where: { provider: { contains: RUN } } })
      .catch(() => {});
    for (const id of userIds) {
      await db.user.delete({ where: { id } }).catch(() => {});
    }
    await db.$disconnect();
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
