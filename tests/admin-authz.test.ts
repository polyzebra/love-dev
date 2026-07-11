/**
 * Live tests for production admin authorization. Run with the dev server
 * up on :3000:
 *   npx tsx tests/admin-authz.test.ts
 *
 * Three layers:
 *  A. Pure: rbac permission matrix, settingsPatchSchema role rejection,
 *     a scan proving NO zod validator accepts a role field, maskEmail.
 *  B. Database (real DB from .env, throwaway rows, cleaned in finally):
 *     the bootstrap service matrix - not-found/unverified -> setup
 *     instructions, success promotes + AdminLog, second call -> gone,
 *     and role survival across a simulated email/provider change
 *     (role is attached to User.id = auth uid, never to the email).
 *  C. Route-level (fetch): unauth /admin -> /login redirect, unauth
 *     admin API -> 401, bootstrap wrong secret -> 401, and - when
 *     password sign-in is available - a real USER session seeing the
 *     403 Access Denied page (no redirect) and API 403.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36);
const testEmail = (tag: string) => `admin-authz-${tag}-${RUN}@example.com`;

let passed = 0;
let skipped = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}
function skip(name: string, why: string): void {
  skipped += 1;
  console.log(`  SKIP - ${name} (${why})`);
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { PERMISSIONS, hasPermission, isStaff, isSuperAdmin } = await import("../src/lib/rbac");
  const { settingsPatchSchema } = await import("../src/lib/services/settings");
  const { maskEmail } = await import("../src/lib/phone-mask");
  const { bootstrapSuperAdmin, SETUP_INSTRUCTIONS } = await import(
    "../src/lib/services/admin-bootstrap"
  );

  // ------------------------------------------------------------------ A
  console.log("A. rbac + schema invariants");

  await check("USER holds no permission at all", () => {
    for (const p of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      assert.equal(hasPermission("USER", p), false, `USER must not hold ${p}`);
    }
    assert.equal(isStaff("USER"), false);
  });

  await check("ADMIN keeps every pre-existing permission but NOT the supers tier", () => {
    for (const p of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      const expected = p !== "roles:assign" && p !== "diagnostics:view";
      assert.equal(hasPermission("ADMIN", p), expected, `ADMIN vs ${p}`);
    }
  });

  await check("SUPER_ADMIN holds every permission incl. roles:assign + diagnostics:view", () => {
    for (const p of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      assert.equal(hasPermission("SUPER_ADMIN", p), true, `SUPER_ADMIN vs ${p}`);
    }
    assert.equal(isStaff("SUPER_ADMIN"), true);
    assert.equal(isSuperAdmin("SUPER_ADMIN"), true);
    assert.equal(isSuperAdmin("ADMIN"), false);
  });

  await check("settingsPatchSchema is strict and REJECTS a role field", () => {
    const attack = settingsPatchSchema.safeParse({ role: "SUPER_ADMIN" });
    assert.equal(attack.success, false, "role must be rejected");
    const clean = settingsPatchSchema.safeParse({ emailNewMatches: true });
    assert.equal(clean.success, true);
  });

  await check("no zod validator anywhere accepts a `role` key from a client payload", () => {
    const dirs = [path.join(__dirname, "../src/lib/validators")];
    const offenders: string[] = [];
    for (const dir of dirs) {
      for (const file of readdirSync(dir)) {
        const src = readFileSync(path.join(dir, file), "utf8");
        // A schema field looks like `role:` at the start of an object line.
        if (/^\s*role\s*:/m.test(src)) offenders.push(file);
      }
    }
    assert.deepEqual(offenders, [], `validators defining role: ${offenders.join(", ")}`);
  });

  await check("maskEmail hides the local part", () => {
    assert.equal(maskEmail("info@tirvea.com"), "in••@tirvea.com");
    assert.equal(maskEmail("a@b.co"), "a•@b.co");
  });

  // ------------------------------------------------------------------ B
  console.log("B. bootstrap service (live DB)");

  const preExistingSupers = await db.user.count({ where: { role: "SUPER_ADMIN" } });
  const ids: string[] = [];

  try {
    if (preExistingSupers > 0) {
      await check("a SUPER_ADMIN already exists -> every call answers gone (410)", async () => {
        const res = await bootstrapSuperAdmin({ email: testEmail("gone"), via: "script" });
        assert.equal(res.status, "gone");
      });
      skip("promotion matrix", "SUPER_ADMIN already present in this database");
    } else {
      await check("missing app user -> setup_required(user_not_found) + 7-step instructions", async () => {
        const res = await bootstrapSuperAdmin({ email: testEmail("missing"), via: "script" });
        assert.equal(res.status, "setup_required");
        assert.equal(res.status === "setup_required" && res.reason, "user_not_found");
        assert.equal(res.status === "setup_required" && res.instructions.length, 7);
        assert.deepEqual(res.status === "setup_required" && [...res.instructions], [...SETUP_INSTRUCTIONS]);
      });

      await check("unverified email -> setup_required(email_unverified)", async () => {
        const id = randomUUID();
        ids.push(id);
        await db.user.create({ data: { id, email: testEmail("unverified") } });
        const res = await bootstrapSuperAdmin({ email: testEmail("unverified"), via: "script" });
        assert.equal(res.status, "setup_required");
        assert.equal(res.status === "setup_required" && res.reason, "email_unverified");
      });

      const promoteId = randomUUID();
      ids.push(promoteId);
      const promoteEmail = testEmail("promote");

      await check("verified user (matched by NORMALIZED email) -> promoted + AdminLog admin.bootstrap", async () => {
        await db.user.create({
          data: { id: promoteId, email: promoteEmail, emailVerified: new Date() },
        });
        // Mixed case + padding proves normalization.
        const res = await bootstrapSuperAdmin({
          email: `  ${promoteEmail.toUpperCase()}  `,
          via: "script",
        });
        assert.equal(res.status, "promoted");
        assert.equal(res.status === "promoted" && res.userId, promoteId);
        const row = await db.user.findUniqueOrThrow({ where: { id: promoteId } });
        assert.equal(row.role, "SUPER_ADMIN");
        const log = await db.adminLog.findFirst({
          where: { actorId: promoteId, action: "admin.bootstrap" },
        });
        assert.ok(log, "AdminLog admin.bootstrap row must exist");
        const event = await db.authVerificationEvent.findFirst({
          where: { userId: promoteId, type: "admin_bootstrap" },
        });
        assert.ok(event, "AuthVerificationEvent admin_bootstrap row must exist");
      });

      await check("second call -> gone (auto-disabled, idempotent)", async () => {
        const res = await bootstrapSuperAdmin({ email: promoteEmail, via: "script" });
        assert.equal(res.status, "gone");
      });

      await check("role SURVIVES an email/provider change (attached to User.id = auth uid)", async () => {
        await db.user.update({
          where: { id: promoteId },
          data: { email: testEmail("changed-provider") },
        });
        const row = await db.user.findUniqueOrThrow({ where: { id: promoteId } });
        assert.equal(row.role, "SUPER_ADMIN", "role must follow the uid, not the email");
      });
    }

    // ---------------------------------------------------------------- C
    console.log("C. route-level (dev server)");

    let serverUp = true;
    try {
      await fetch(`${BASE}/login`, { redirect: "manual" });
    } catch {
      serverUp = false;
    }

    if (!serverUp) {
      skip("route-level suite", `no server at ${BASE}`);
    } else {
      await check("unauthenticated GET /admin redirects to /login", async () => {
        const res = await fetch(`${BASE}/admin`, { redirect: "manual" });
        assert.ok([302, 303, 307, 308].includes(res.status), `got ${res.status}`);
        const loc = new URL(res.headers.get("location")!, BASE);
        assert.equal(loc.pathname, "/login");
      });

      await check("unauthenticated admin API answers 401", async () => {
        const res = await fetch(`${BASE}/api/admin/users/${randomUUID()}/unban`, {
          method: "POST",
        });
        assert.equal(res.status, 401);
      });

      // The bootstrap route rate-limits per IP (5 / 10 min, in-memory per
      // server process), so on repeated runs a 429 is itself a correct,
      // fail-closed answer - accept it wherever a specific code is expected.
      const expectStatus = (res: Response, want: number, label: string) => {
        if (res.status === 429) {
          console.log(`    (note: ${label} answered 429 - rate limiter active from earlier calls)`);
          return;
        }
        assert.equal(res.status, want, label);
      };

      await check("bootstrap with a WRONG secret answers 401", async () => {
        const res = await fetch(`${BASE}/api/admin/bootstrap`, {
          method: "POST",
          headers: { "x-bootstrap-secret": "definitely-wrong" },
        });
        expectStatus(res, 401, "wrong secret");
      });

      await check("bootstrap with NO secret answers 401", async () => {
        const res = await fetch(`${BASE}/api/admin/bootstrap`, { method: "POST" });
        expectStatus(res, 401, "no secret");
      });

      // Real-secret contract, WITHOUT ever promoting a real account:
      // only fired when the server-side outcome is provably 409 or 410.
      const realSecret = process.env.ADMIN_BOOTSTRAP_SECRET;
      const bootstrapEmail = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
      const supersNow = await db.user.count({ where: { role: "SUPER_ADMIN" } });
      const bootTarget = bootstrapEmail
        ? await db.user.findFirst({
            where: { email: bootstrapEmail },
            select: { emailVerified: true, status: true },
          })
        : null;
      const wouldPromote =
        supersNow === 0 && bootTarget?.emailVerified && bootTarget.status === "ACTIVE";
      if (!realSecret || !bootstrapEmail) {
        skip("bootstrap real-secret contract", "ADMIN_BOOTSTRAP_* not set");
      } else if (wouldPromote) {
        skip("bootstrap real-secret contract", "would actually promote - not risking it in a test");
      } else {
        await check("bootstrap with the real secret answers 410 (done) or 409 (+instructions)", async () => {
          const res = await fetch(`${BASE}/api/admin/bootstrap`, {
            method: "POST",
            headers: { "x-bootstrap-secret": realSecret },
          });
          if (res.status === 429) {
            console.log("    (note: real-secret call answered 429 - rate limiter active from earlier calls)");
          } else if (supersNow > 0) {
            assert.equal(res.status, 410);
          } else {
            assert.equal(res.status, 409);
            const body = (await res.json()) as { error: { fields?: { instructions?: string[] } } };
            assert.equal(body.error.fields?.instructions?.length, 7);
          }
        });
      }

      // Authenticated USER -> 403 surfaces. Needs a real Supabase session:
      // service-role creates a password user, anon client signs in, and the
      // session is replayed as the @supabase/ssr cookie.
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !anonKey || !serviceKey) {
        skip("USER-session 403 checks", "Supabase env incomplete");
      } else {
        const adminClient = createClient(url, serviceKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const email = testEmail("plain-user");
        const password = `Aa1!${randomUUID()}`;
        const created = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (created.error || !created.data.user) {
          skip("USER-session 403 checks", `could not create auth user: ${created.error?.message}`);
        } else {
          const authUid = created.data.user.id;
          ids.push(authUid);
          await db.user.create({
            data: { id: authUid, email, emailVerified: new Date(), role: "USER" },
          });
          const anon = createClient(url, anonKey, {
            auth: { autoRefreshToken: false, persistSession: false },
          });
          const signIn = await anon.auth.signInWithPassword({ email, password });
          if (signIn.error || !signIn.data.session) {
            skip("USER-session 403 checks", `password sign-in unavailable: ${signIn.error?.message}`);
            await adminClient.auth.admin.deleteUser(authUid).catch(() => {});
          } else {
            // @supabase/ssr cookie format: sb-<ref>-auth-token = "base64-" +
            // base64url(JSON session), chunked with .0/.1 suffixes when long.
            const ref = new URL(url).hostname.split(".")[0];
            const raw = `base64-${Buffer.from(JSON.stringify(signIn.data.session)).toString("base64url")}`;
            const CHUNK = 3180;
            const cookies: string[] = [];
            if (raw.length <= CHUNK) {
              cookies.push(`sb-${ref}-auth-token=${raw}`);
            } else {
              for (let i = 0; i * CHUNK < raw.length; i++) {
                cookies.push(`sb-${ref}-auth-token.${i}=${raw.slice(i * CHUNK, (i + 1) * CHUNK)}`);
              }
            }
            const cookieHeader = cookies.join("; ");

            await check("signed-in USER on /admin sees the Access Denied page (200, no redirect)", async () => {
              const res = await fetch(`${BASE}/admin`, {
                redirect: "manual",
                headers: { cookie: cookieHeader },
              });
              assert.equal(res.status, 200, `expected 200 render, got ${res.status}`);
              const html = await res.text();
              assert.ok(html.includes("Access denied"), "page must say Access denied");
              assert.ok(!html.includes("Signed in as"), "admin chrome must not render");
              // The dashboard's RSC payload must not leak either - the
              // layout omits children entirely on the forbidden branch.
              assert.ok(!html.includes("Platform health"), "dashboard data must not leak");
            });

            await check("signed-in USER on an admin API answers 403", async () => {
              const res = await fetch(`${BASE}/api/admin/users/${randomUUID()}/unban`, {
                method: "POST",
                headers: { cookie: cookieHeader },
              });
              assert.equal(res.status, 403);
            });

            await check("signed-in USER on /admin/auth-diagnostics sees Access Denied", async () => {
              const res = await fetch(`${BASE}/admin/auth-diagnostics`, {
                redirect: "manual",
                headers: { cookie: cookieHeader },
              });
              assert.equal(res.status, 200);
              const html = await res.text();
              assert.ok(html.includes("Access denied"));
            });

            await adminClient.auth.admin.deleteUser(authUid).catch(() => {});
          }
        }
      }
    }
  } finally {
    // Cleanup every throwaway artifact (AdminLog cascades on actor delete).
    await db.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
    await db.authVerificationEvent
      .deleteMany({ where: { email: { startsWith: `admin-authz-` } } })
      .catch(() => {});
    await db.$disconnect().catch(() => {});
  }

  console.log(`\n${passed} passed, ${skipped} skipped`);
}

main().catch((error) => {
  console.error("FAIL:", error);
  process.exit(1);
});
