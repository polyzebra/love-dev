/**
 * Live end-to-end tests for the dual authentication transport (Phase 0C):
 *   npx tsx tests/bearer-live.test.ts
 *
 * Requires: real Supabase credentials in .env (live lane) AND the dev
 * server on localhost:3000 (route-level checks skip with a notice when
 * it is not reachable - same convention as billing.test.ts).
 *
 * Verifies against REAL Supabase-verified tokens on REAL guarded routes:
 *  - valid cookie session / valid Bearer / both matching -> 200
 *  - missing credentials, malformed headers, tampered signature,
 *    unsigned (alg:none) tokens, expired-shape tokens -> 401
 *  - conflicting cookie+Bearer identities -> 401 (never picks a user)
 *  - suspended user via Bearer -> 403 account_restricted
 *  - permission-protected route via non-staff Bearer -> 403
 *  - no token material ever appears in a response body
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const RUN = Date.now().toString(36);
const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const ROUTE = `${BASE}/api/push/status`; // simple requireSession GET
const ADMIN_ROUTE = `${BASE}/api/admin/safety/cases`; // requirePermission("safety:read")

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}
function skip(name: string, why: string) {
  console.log(`  skip - ${name} (${why})`);
}

const b64url = (s: string) => Buffer.from(s).toString("base64url");

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
    skip("all bearer route checks", "dev server not running");
    await db.$disconnect();
    console.log(`\n${passed} checks passed`);
    return;
  }

  // ---- fixtures: two real auth users with app rows ----------------------
  const password = `bearer-test-${RUN}-Aa1!`;
  const mkUser = async (tag: string) => {
    const email = `bearer-${tag}-${RUN}@example.com`;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    const uid = created.data.user!.id;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: `Bearer ${tag}`,
        emailVerified: now,
        phone: `+35387${String(Math.floor(Math.random() * 9000000) + 1000000)}`,
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
    const signIn = await anon.auth.signInWithPassword({ email, password });
    const session = signIn.data.session!;
    // Cookie header exactly as the app's SSR client would write it.
    const jar: { name: string; value: string }[] = [];
    const ssr = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => jar,
        setAll: (all) => {
          for (const c of all) jar.push({ name: c.name, value: c.value });
        },
      },
    });
    await ssr.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    const cookieHeader = jar.map((c) => `${c.name}=${c.value}`).join("; ");
    return { uid, email, token: session.access_token, cookieHeader };
  };

  const a = await mkUser("a");
  const b = await mkUser("b");

  const call = (route: string, headers: Record<string, string> = {}) =>
    fetch(route, { headers });

  try {
    console.log("bearer transport, live:");

    await check("missing credentials -> 401 with the standard envelope", async () => {
      const res = await call(ROUTE);
      assert.equal(res.status, 401);
      const body = (await res.json()) as { error?: { code?: string } };
      assert.equal(body.error?.code, "unauthorized");
    });

    await check("valid cookie session -> 200 (web behaviour preserved)", async () => {
      const res = await call(ROUTE, { cookie: a.cookieHeader });
      assert.equal(res.status, 200);
      assert.ok((await res.json()).data !== undefined);
    });

    await check("valid Bearer token -> 200 (native transport)", async () => {
      const res = await call(ROUTE, { authorization: `Bearer ${a.token}` });
      assert.equal(res.status, 200);
      assert.ok((await res.json()).data !== undefined);
    });

    await check("matching cookie AND Bearer identities -> 200", async () => {
      const res = await call(ROUTE, {
        cookie: a.cookieHeader,
        authorization: `Bearer ${a.token}`,
      });
      assert.equal(res.status, 200);
    });

    await check("CONFLICTING cookie and Bearer identities -> 401, never a silent pick", async () => {
      const res = await call(ROUTE, {
        cookie: a.cookieHeader,
        authorization: `Bearer ${b.token}`,
      });
      assert.equal(res.status, 401);
    });

    await check("malformed Authorization headers -> 401 even with a valid cookie", async () => {
      for (const bad of ["Bearer", "Basic dXNlcjpwdw==", "Bearer a b", "Token x"]) {
        const res = await call(ROUTE, { cookie: a.cookieHeader, authorization: bad });
        assert.equal(res.status, 401, bad);
      }
    });

    await check("tampered signature -> 401 (verified by Supabase, not decoded locally)", async () => {
      const parts = a.token.split(".");
      const flipped = parts[2].slice(0, -6) + (parts[2].endsWith("AAAAAA") ? "BBBBBB" : "AAAAAA");
      const res = await call(ROUTE, {
        authorization: `Bearer ${parts[0]}.${parts[1]}.${flipped}`,
      });
      assert.equal(res.status, 401);
    });

    await check("unsigned alg:none token -> 401 (unsigned contents are never trusted)", async () => {
      const header = b64url(JSON.stringify({ alg: "none", typ: "JWT" }));
      const payload = b64url(
        JSON.stringify({
          sub: a.uid,
          aud: "authenticated",
          role: "authenticated",
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      );
      const res = await call(ROUTE, { authorization: `Bearer ${header}.${payload}.` });
      assert.equal(res.status, 401);
    });

    await check("expired-shape token -> 401 (expiry validated server-side)", async () => {
      const header = b64url(JSON.stringify({ alg: "ES256", typ: "JWT" }));
      const payload = b64url(
        JSON.stringify({
          sub: a.uid,
          aud: "authenticated",
          exp: Math.floor(Date.now() / 1000) - 3600,
        }),
      );
      const res = await call(ROUTE, {
        authorization: `Bearer ${header}.${payload}.${b64url("nosig")}`,
      });
      assert.equal(res.status, 401);
    });

    await check("error responses never leak token material", async () => {
      const res = await call(ROUTE, {
        cookie: a.cookieHeader,
        authorization: `Bearer ${b.token}`,
      });
      const text = await res.text();
      assert.ok(!text.includes(b.token.slice(0, 24)), "no token fragment in body");
      assert.ok(!text.includes(a.cookieHeader.slice(0, 24)), "no cookie fragment in body");
    });

    await check("suspended user via Bearer -> 403 account_restricted", async () => {
      await db.user.update({ where: { id: a.uid }, data: { status: "SUSPENDED" } });
      const res = await call(ROUTE, { authorization: `Bearer ${a.token}` });
      assert.equal(res.status, 403);
      const body = (await res.json()) as { error?: { code?: string } };
      assert.equal(body.error?.code, "account_restricted");
      await db.user.update({ where: { id: a.uid }, data: { status: "ACTIVE" } });
    });

    await check("DELETED user via Bearer -> 401 (principal rejected)", async () => {
      await db.user.update({ where: { id: b.uid }, data: { status: "DELETED" } });
      const res = await call(ROUTE, { authorization: `Bearer ${b.token}` });
      assert.equal(res.status, 401);
    });

    await check("permission-protected route via non-staff Bearer -> 403", async () => {
      const res = await call(ADMIN_ROUTE, { authorization: `Bearer ${a.token}` });
      assert.equal(res.status, 403);
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
