/**
 * Regression: the REAL /api/auth/email-attach/send journey for a NATIVE
 * phone-first account whose auth.users.email is empty. The OTP refactor
 * switched the mint to admin.generateLink({ type: "email_change_new" }),
 * which needs a current email to move FROM - phone-first accounts have
 * none, so the mint failed and the screen wrongly showed a transport error
 * ("We couldn't send the code"). mintEmailChangeOtp now seeds the account's
 * placeholder onto auth.users first. Run with the dev server on :3000 AND
 * real Supabase creds:
 *   npx tsx tests/email-attach-phone-first.test.ts
 *
 * Drives the real endpoint over HTTP with a forged (real) session cookie.
 * Creates throwaway auth users + app rows; cleaned up in finally. Skips
 * cleanly if the dev server is unreachable.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main() {
  // Skip cleanly when the dev server is not up (this suite needs it).
  try {
    await fetch(`${BASE}/login`, { method: "HEAD" });
  } catch {
    console.log("  (skipped - dev server not reachable on", BASE + ")");
    console.log(`\n${passed} checks passed`);
    return;
  }

  const { db } = await import("../src/lib/db");
  const { phonePlaceholderEmail } = await import("../src/lib/auth/identity");
  const RUN = Date.now().toString(36);
  const cleanup: string[] = [];

  // A native phone-first account: phone-only auth user (NO email), password
  // for a session, and an app row on the placeholder, not yet onboarded.
  const phone = "+1519555" + Math.floor(1000 + Math.random() * 8999);
  const password = `Test-${RUN}-pw!`;
  const created = await admin.auth.admin.createUser({ phone, password, phone_confirm: true });
  const uid = created.data.user!.id;
  cleanup.push(uid);
  await db.user.create({
    data: {
      id: uid,
      email: phonePlaceholderEmail(uid),
      phone,
      phoneE164: phone,
      phoneVerifiedAt: new Date(),
      status: "ACTIVE",
      onboardingDone: false,
      lastActiveAt: new Date(),
    },
  });

  const si = await anon.auth.signInWithPassword({ phone, password });
  assert.ok(si.data.session, "phone-first session established");
  const jar: Record<string, string> = {};
  const ssr = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })),
      setAll: (all) => {
        for (const { name, value } of all) jar[name] = value;
      },
    },
  });
  await ssr.auth.setSession({
    access_token: si.data.session.access_token,
    refresh_token: si.data.session.refresh_token,
  });
  const cookie = Object.entries(jar)
    .map(([n, v]) => `${n}=${encodeURIComponent(v)}`)
    .join("; ");

  const send = async (email: string) => {
    const res = await fetch(`${BASE}/api/auth/email-attach/send`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ email }),
    });
    return {
      status: res.status,
      body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
    };
  };

  try {
    await check(
      "phone-first + fresh email -> 200 sent (advances to OTP; NOT send_failed)",
      async () => {
        const before = (await admin.auth.admin.getUserById(uid)).data.user?.email;
        assert.ok(!before, "precondition: auth.users.email is empty for a phone-first account");
        const r = await send(`attach-fresh-${RUN}@example.com`);
        assert.equal(r.status, 200, `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
        assert.equal(r.body.ok, true, "the send succeeded");
        const after = (await admin.auth.admin.getUserById(uid)).data.user?.email ?? "";
        assert.ok(
          after.endsWith("@placeholder.tirvea.app"),
          "the placeholder was seeded onto auth.users so the mint could run",
        );
      },
    );

    await check(
      "phone-first + already-registered email -> 409 email_in_use (NOT send_failed)",
      async () => {
        const takenEmail = `taken-${RUN}@example.com`;
        const tk = await admin.auth.admin.createUser({ email: takenEmail, email_confirm: true });
        cleanup.push(tk.data.user!.id);
        const r = await send(takenEmail);
        assert.equal(r.status, 409, `expected 409 email_in_use, got ${r.status}`);
        assert.equal(r.body.code, "email_in_use", "classified as email_in_use, not send_failed");
      },
    );
  } finally {
    await db.user.delete({ where: { id: uid } }).catch(() => {});
    for (const id of cleanup) await admin.auth.admin.deleteUser(id).catch(() => {});
    await db.$disconnect();
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
