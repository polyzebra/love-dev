/**
 * Live tests for the Phase 0E server-action migration:
 *   npx tsx tests/api-0e.test.ts
 *
 * Live lane: real Supabase credentials + the dev server on :3000
 * (route checks skip with a notice when unreachable). Verifies that
 * every mutation that previously existed ONLY as a Next.js server
 * action is now a canonical, versioned HTTP route with the same
 * authentication/authorization rules:
 *  - PATCH /api/v1/me/settings (strict schema, session identity)
 *  - GET   /api/v1/billing/purchases (honest restore read)
 *  - PUT   /api/v1/profile/prompts (replace set, curated order)
 *  - POST  /api/v1/admin/users/[id]/status      (users:suspend)
 *  - POST  /api/v1/admin/reports/[id]/resolve   (reports:resolve)
 *  - POST  /api/v1/admin/verifications/[id]/review (verifications:review)
 *  - PUT   /api/v1/admin/flags/[key]            (flags:manage)
 *  - POST  /api/v1/admin/explore/categories/[id]/toggle + /move
 * Explore fixtures are created INACTIVE with far-out sort orders so the
 * shared database's real explore surface is never touched.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const RUN = Date.now().toString(36);
const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const V1 = `${BASE}/api/v1`;

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
    skip("all 0E route checks", "dev server not running");
    await db.$disconnect();
    console.log(`\n${passed} checks passed`);
    return;
  }

  const password = `oe-test-${RUN}-Aa1!`;
  const mkUser = async (tag: string, phoneTail: string, role: "USER" | "MODERATOR" | "ADMIN") => {
    const email = `oe-${tag}-${RUN}@example.com`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const uid = created.data.user!.id;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: `OE ${tag}`,
        role,
        emailVerified: now,
        phone: `+3538798${phoneTail}`,
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

  const member = await mkUser("member", `1${RUN.slice(-4)}`, "USER");
  const target = await mkUser("target", `2${RUN.slice(-4)}`, "USER");
  const mod = await mkUser("mod", `3${RUN.slice(-4)}`, "MODERATOR");
  const boss = await mkUser("boss", `4${RUN.slice(-4)}`, "ADMIN");

  // Fixtures the mutations act on.
  const profile = await db.profile.create({
    data: {
      userId: member.uid,
      displayName: "OE Member",
      birthDate: new Date("1995-06-15"),
      gender: "WOMAN",
    },
  });
  const report = await db.report.create({
    data: { reporterId: member.uid, reportedId: target.uid, reason: "SPAM" },
  });
  const verification = await db.verification.create({
    data: { userId: target.uid, type: "PHOTO", status: "PENDING" },
  });
  const flagKey = `oe-test.flag-${RUN}`;
  // Inactive + far-out sortOrder: invisible on /explore, and `move` can
  // only ever swap the two test rows with each other.
  const catA = await db.exploreCategory.create({
    data: {
      slug: `oe-test-a-${RUN}`,
      title: "OE Test A",
      group: "INTERESTS",
      iconKey: "sparkles",
      sortOrder: 900000,
      isActive: false,
    },
  });
  const catB = await db.exploreCategory.create({
    data: {
      slug: `oe-test-b-${RUN}`,
      title: "OE Test B",
      group: "INTERESTS",
      iconKey: "sparkles",
      sortOrder: 900001,
      isActive: false,
    },
  });

  const call = (
    method: string,
    path: string,
    opts: { token?: string; body?: unknown } = {},
  ): Promise<Response> =>
    fetch(`${V1}${path}`, {
      method,
      headers: {
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

  try {
    console.log("phase 0E migrated mutations, live:");

    // ---- settings ------------------------------------------------------
    await check("PATCH /me/settings persists a field and echoes the row", async () => {
      const res = await call("PATCH", "/me/settings", {
        token: member.token,
        body: { pushMessages: false },
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { data: { pushMessages: boolean } };
      assert.equal(body.data.pushMessages, false);
      const row = await db.userSettings.findUnique({ where: { userId: member.uid } });
      assert.equal(row?.pushMessages, false);
    });

    await check("PATCH /me/settings rejects unknown fields (422)", async () => {
      const res = await call("PATCH", "/me/settings", {
        token: member.token,
        body: { role: "ADMIN" },
      });
      assert.equal(res.status, 422);
      const body = (await res.json()) as { error?: { code?: string } };
      assert.equal(body.error?.code, "validation_error");
    });

    await check("PATCH /me/settings without auth -> 401", async () => {
      const res = await call("PATCH", "/me/settings", { body: { pushMessages: true } });
      assert.equal(res.status, 401);
    });

    // ---- purchases -------------------------------------------------------
    await check("GET /billing/purchases reports records honestly", async () => {
      const res = await call("GET", "/billing/purchases", { token: member.token });
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        data: { payments: number; subscriptionTier: string | null };
      };
      assert.equal(body.data.payments, 0);
      assert.equal(body.data.subscriptionTier, null);
    });

    // ---- prompts ---------------------------------------------------------
    await check("PUT /profile/prompts replaces the whole answer set", async () => {
      const first = await call("PUT", "/profile/prompts", {
        token: member.token,
        body: [
          { key: "green-flags", answer: "Kindness" },
          { key: "typical-saturday", answer: "Sea swim" },
        ],
      });
      assert.equal(first.status, 200);
      assert.equal(((await first.json()) as { data: { count: number } }).data.count, 2);
      // Curated order: typical-saturday is first in PROFILE_PROMPTS.
      const rows = await db.profilePrompt.findMany({
        where: { profileId: profile.id },
        orderBy: { sortOrder: "asc" },
      });
      assert.deepEqual(
        rows.map((r) => r.promptKey),
        ["typical-saturday", "green-flags"],
      );
      const second = await call("PUT", "/profile/prompts", {
        token: member.token,
        body: [{ key: "green-flags", answer: "Curiosity" }],
      });
      assert.equal(second.status, 200);
      assert.equal(await db.profilePrompt.count({ where: { profileId: profile.id } }), 1);
    });

    await check("PUT /profile/prompts enforces the max-4 rule (422)", async () => {
      const res = await call("PUT", "/profile/prompts", {
        token: member.token,
        body: [
          "typical-saturday",
          "perfect-first-date",
          "green-flags",
          "relationship-style",
          "favourite-place",
        ].map((key) => ({ key, answer: "x" })),
      });
      assert.equal(res.status, 422);
    });

    await check("PUT /profile/prompts with no profile -> 404", async () => {
      const res = await call("PUT", "/profile/prompts", {
        token: target.token,
        body: [{ key: "green-flags", answer: "Honesty" }],
      });
      assert.equal(res.status, 404);
    });

    // ---- admin: user status ---------------------------------------------
    await check("member calling an admin route -> 403 (never 500)", async () => {
      const res = await call("POST", `/admin/users/${target.uid}/status`, {
        token: member.token,
        body: { status: "SUSPENDED" },
      });
      assert.equal(res.status, 403);
    });

    await check("moderator sets status; audit + auth timeline recorded", async () => {
      const res = await call("POST", `/admin/users/${target.uid}/status`, {
        token: mod.token,
        body: { status: "SUSPENDED" },
      });
      assert.equal(res.status, 200);
      const row = await db.user.findUnique({ where: { id: target.uid } });
      assert.equal(row?.status, "SUSPENDED");
      const log = await db.adminLog.findFirst({
        where: { actorId: mod.uid, action: "user.status.suspended", targetId: target.uid },
      });
      assert.ok(log, "AdminLog row written");
      // restore
      const back = await call("POST", `/admin/users/${target.uid}/status`, {
        token: mod.token,
        body: { status: "ACTIVE" },
      });
      assert.equal(back.status, 200);
    });

    await check("self-targeting the status route -> 400", async () => {
      const res = await call("POST", `/admin/users/${mod.uid}/status`, {
        token: mod.token,
        body: { status: "SUSPENDED" },
      });
      assert.equal(res.status, 400);
    });

    // ---- admin: report resolve -------------------------------------------
    await check("moderator resolves a report with a resolution note", async () => {
      const res = await call("POST", `/admin/reports/${report.id}/resolve`, {
        token: mod.token,
        body: { outcome: "ACTION_TAKEN", resolution: "Warning issued" },
      });
      assert.equal(res.status, 200);
      const row = await db.report.findUnique({ where: { id: report.id } });
      assert.equal(row?.status, "ACTION_TAKEN");
      assert.equal(row?.resolvedById, mod.uid);
      assert.ok(row?.resolvedAt);
    });

    // ---- admin: verification review --------------------------------------
    await check("PHOTO approval stamps User.photoVerifiedAt atomically", async () => {
      const res = await call("POST", `/admin/verifications/${verification.id}/review`, {
        token: mod.token,
        body: { approve: true },
      });
      assert.equal(res.status, 200);
      const [row, owner] = await Promise.all([
        db.verification.findUnique({ where: { id: verification.id } }),
        db.user.findUnique({ where: { id: target.uid } }),
      ]);
      assert.equal(row?.status, "APPROVED");
      assert.equal(row?.reviewedById, mod.uid);
      assert.ok(owner?.photoVerifiedAt, "badge verdict stamped on the User row");
    });

    // ---- admin: flags (ADMIN-only) ----------------------------------------
    await check("moderator setting a flag -> 403 (flags:manage is admin-tier)", async () => {
      const res = await call("PUT", `/admin/flags/${flagKey}`, {
        token: mod.token,
        body: { enabled: true },
      });
      assert.equal(res.status, 403);
    });

    await check("admin upserts a flag by key", async () => {
      const res = await call("PUT", `/admin/flags/${flagKey}`, {
        token: boss.token,
        body: { enabled: true },
      });
      assert.equal(res.status, 200);
      const row = await db.featureFlag.findUnique({ where: { key: flagKey } });
      assert.equal(row?.enabled, true);
    });

    // ---- admin: explore curation ------------------------------------------
    await check("toggle + move swap only the two test categories", async () => {
      const toggle = await call("POST", `/admin/explore/categories/${catA.id}/toggle`, {
        token: boss.token,
        body: { isActive: false },
      });
      assert.equal(toggle.status, 200);

      const move = await call("POST", `/admin/explore/categories/${catB.id}/move`, {
        token: boss.token,
        body: { direction: "up" },
      });
      assert.equal(move.status, 200);
      assert.equal(((await move.json()) as { data: { moved: boolean } }).data.moved, true);
      const [a, b] = await Promise.all([
        db.exploreCategory.findUnique({ where: { id: catA.id } }),
        db.exploreCategory.findUnique({ where: { id: catB.id } }),
      ]);
      assert.equal(a?.sortOrder, 900001);
      assert.equal(b?.sortOrder, 900000);
    });

    await check("explore PATCH edits presentation fields", async () => {
      const res = await call("PATCH", `/admin/explore/categories/${catA.id}`, {
        token: boss.token,
        body: { title: "OE Test A2", gradientFrom: "#112233" },
      });
      assert.equal(res.status, 200);
      const row = await db.exploreCategory.findUnique({ where: { id: catA.id } });
      assert.equal(row?.title, "OE Test A2");
      assert.equal(row?.gradientFrom, "#112233");
    });

    await check("explore PATCH rejects unknown fields (422)", async () => {
      const res = await call("PATCH", `/admin/explore/categories/${catA.id}`, {
        token: boss.token,
        body: { slug: "hijack" },
      });
      assert.equal(res.status, 422);
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    await db.exploreCategory
      .deleteMany({ where: { id: { in: [catA.id, catB.id] } } })
      .catch(() => {});
    await db.featureFlag.delete({ where: { key: flagKey } }).catch(() => {});
    for (const u of [member, target, mod, boss]) {
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
