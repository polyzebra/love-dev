/**
 * Live tests for the abandoned-auth-user sweeper. Run with:
 *   npx tsx tests/auth-cleanup.test.ts
 *
 * Talks to the real database from .env. Seeds throwaway rows straight
 * into auth.users (namespaced emails + random uuids) and cleans up every
 * artifact in `finally`.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { User as SupabaseAuthUser } from "@supabase/supabase-js";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";

const RUN = Date.now().toString(36);
const testEmail = (tag: string) => `auth-cleanup-${tag}-${RUN}@example.com`;

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { cleanupAbandonedAuthUsers } = await import("../src/lib/auth/cleanup");
  const { ensureAppUser } = await import("../src/lib/auth/identity");

  const testStart = new Date();

  /** Seed a throwaway auth.users row directly via SQL. */
  async function seedAuthUser(opts: {
    email: string;
    ageHours: number;
    confirmed?: boolean;
  }): Promise<string> {
    const id = randomUUID();
    await db.$executeRaw`
      INSERT INTO auth.users
        (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at,
         raw_app_meta_data, raw_user_meta_data, is_sso_user)
      VALUES
        (${id}::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated',
         'authenticated', ${opts.email},
         ${opts.confirmed ? new Date() : null},
         now() - make_interval(hours => ${opts.ageHours}),
         now() - make_interval(hours => ${opts.ageHours}),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false)`;
    return id;
  }

  async function authRowExists(id: string): Promise<boolean> {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM auth.users WHERE id = ${id}::uuid`;
    return rows.length > 0;
  }

  const emails = {
    stale: testEmail("stale-pending"), // 25h old, unconfirmed, no app row -> DELETED
    fresh: testEmail("fresh-pending"), // 23h old, unconfirmed -> survives
    confirmed: testEmail("confirmed-no-app"), // confirmed, no app row -> survives
    withApp: testEmail("pending-with-app"), // unconfirmed 25h old BUT has app row -> survives
    verified: testEmail("verified-flow"), // ensureAppUser happy path
  };
  const ids: Record<string, string> = {};

  try {
    console.log("cleanupAbandonedAuthUsers - sweep matrix");
    ids.stale = await seedAuthUser({ email: emails.stale, ageHours: 25 });
    ids.fresh = await seedAuthUser({ email: emails.fresh, ageHours: 23 });
    ids.confirmed = await seedAuthUser({ email: emails.confirmed, ageHours: 30, confirmed: true });
    ids.withApp = await seedAuthUser({ email: emails.withApp, ageHours: 25 });
    await db.user.create({ data: { id: ids.withApp, email: emails.withApp } });

    const deleted = await cleanupAbandonedAuthUsers();

    await check("returns a deleted count >= 1", () => assert.ok(deleted >= 1, `deleted=${deleted}`));
    await check("25h-old unconfirmed ghost is deleted", async () =>
      assert.equal(await authRowExists(ids.stale), false),
    );
    await check("23h-old pending signup survives", async () =>
      assert.equal(await authRowExists(ids.fresh), true),
    );
    await check("confirmed-but-no-app-row user survives", async () =>
      assert.equal(await authRowExists(ids.confirmed), true),
    );
    await check("unconfirmed row WITH an app User row survives", async () =>
      assert.equal(await authRowExists(ids.withApp), true),
    );
    await check("sweep is audited as auth_cleanup with count metadata", async () => {
      const event = await db.authVerificationEvent.findFirst({
        where: { type: "auth_cleanup", createdAt: { gte: testStart } },
        orderBy: { createdAt: "desc" },
      });
      assert.ok(event, "auth_cleanup event recorded");
      assert.equal(event.userId, null);
      assert.equal((event.metadata as { count?: number }).count, deleted);
    });

    console.log("verified-OTP path (ensureAppUser)");
    ids.verified = await seedAuthUser({ email: emails.verified, ageHours: 0, confirmed: true });
    const authUser = {
      id: ids.verified,
      email: emails.verified,
      email_confirmed_at: new Date().toISOString(),
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      aud: "authenticated",
      created_at: new Date().toISOString(),
    } as unknown as SupabaseAuthUser;

    await check("verified OTP creates exactly one app User row", async () => {
      const first = await ensureAppUser(authUser);
      assert.ok(first.ok && first.created, "first call creates");
      const second = await ensureAppUser(authUser);
      assert.ok(second.ok && !second.created, "second call reuses");
      const count = await db.user.count({ where: { email: emails.verified } });
      assert.equal(count, 1);
    });

    console.log("invalid-OTP path");
    await check("invalid OTP verifies nothing and creates no app row", async () => {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } },
      );
      const { data, error } = await supabase.auth.verifyOtp({
        email: emails.fresh, // the seeded pending-only ghost
        token: "000000",
        type: "email",
      });
      assert.ok(error, "verifyOtp must fail for a bogus code");
      assert.equal(data.user, null);
      const count = await db.user.count({ where: { email: emails.fresh } });
      assert.equal(count, 0, "pending-only email must have no app User row");
    });

    console.log("admin users list");
    await check("admin list reads the Prisma User table only (no auth-side source)", () => {
      const source = readFileSync(
        path.join(process.cwd(), "src/app/admin/users/page.tsx"),
        "utf8",
      );
      assert.ok(source.includes("db.user.findMany"), "queries db.user.findMany");
      assert.ok(!source.includes("auth.users"), "never touches auth.users");
      assert.ok(!source.includes("$queryRaw"), "no raw SQL side channel");
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    // Cleanup every artifact this run created
    const allEmails = Object.values(emails);
    await db.user.deleteMany({ where: { email: { in: allEmails } } }).catch(() => {});
    for (const email of allEmails) {
      await db.$executeRaw`DELETE FROM auth.users WHERE email = ${email}`.catch(() => {});
    }
    await db.authVerificationEvent
      .deleteMany({
        where: {
          OR: [
            { email: { in: allEmails } },
            { type: "auth_cleanup", createdAt: { gte: testStart } },
          ],
        },
      })
      .catch(() => {});
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("FAIL:", error);
  process.exitCode = 1;
});
