/**
 * Production verification for the explore fix + verification surfaces.
 * DB is shared with production; mints two throwaway test users, exercises
 * https://tirvea.com over HTTP with bearer tokens, then cleans up via the
 * guarded reset CLI.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { db } from "/Users/martins/Desktop/love-dev/src/lib/db";

const BASE = "https://tirvea.com";
const RUN = Date.now().toString(36);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const step = (n: string, ok: boolean, extra = "") =>
  console.log(`  ${ok ? "ok " : "FAIL"} - ${n}${extra ? ` (${extra})` : ""}`);

const mkUser = async (tag: string, tail: string, gender: "MAN" | "WOMAN", verified: boolean) => {
  const email = `e2e-prod-${tag}-${RUN}@example.com`;
  const created = await admin.auth.admin.createUser({
    email,
    password: `ep-${RUN}-Aa1!`,
    email_confirm: true,
  });
  const uid = created.data.user!.id;
  const now = new Date();
  await db.user.create({
    data: {
      id: uid,
      email,
      name: `EP ${tag}`,
      emailVerified: now,
      phone: `+3538785${tail}`,
      phoneVerifiedAt: now,
      ageConfirmedAt: now,
      termsVersion: "2026-07",
      privacyVersion: "2026-07",
      communityVersion: "2026-07",
      onboardingDone: true,
      ...(verified ? { photoVerifiedAt: now } : {}),
    },
  });
  await db.profile.create({
    data: { userId: uid, displayName: `EP ${tag}`, birthDate: new Date("1992-02-02"), gender },
  });
  return { uid, email };
};

async function main() {
  const viewer = await mkUser("viewer", "01", "MAN", false);
  const target = await mkUser("target", "02", "WOMAN", true);
  const token = (await anon.auth.signInWithPassword({ email: viewer.email, password: `ep-${RUN}-Aa1!` }))
    .data.session!.access_token;
  const authed = (path: string) =>
    fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } });

  // 1. deployed build serves the explore fix: payload is the REQUESTED user
  const peek = await authed(`/api/v1/explore/profile/${target.uid}`);
  const body = await peek.text();
  step(
    "PROD explore profile returns the requested user with isVerified:true",
    peek.status === 200 && body.includes(target.uid) && body.includes('"isVerified":true'),
    `HTTP ${peek.status}`,
  );

  // 2. verification surfaces in the deployed environment (report, don't assume)
  const status = await authed(`/api/verification/photo/status`);
  const statusBody = await status.text();
  console.log(`  info - PROD /api/verification/photo/status: HTTP ${status.status} ${statusBody.slice(0, 200)}`);
  const start = await fetch(`${BASE}/api/verification/photo/start`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  const startBody = await start.text();
  console.log(`  info - PROD /api/verification/photo/start: HTTP ${start.status} ${startBody.slice(0, 200)}`);

  // 3. webhook endpoint refuses unsigned posts in production
  const forged = await fetch(`${BASE}/api/webhooks/verification`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "vs_forged", status: "approved" }),
  });
  step("PROD webhook rejects unsigned payloads", forged.status === 401 || forged.status === 503, `HTTP ${forged.status}`);

  // cleanup through the guarded CLI (also a production-data exercise of it)
  for (const u of [viewer, target]) {
    const out = execFileSync(
      "npx",
      ["tsx", "scripts/reset-test-user.ts", u.email, "--confirm"],
      { cwd: "/Users/martins/Desktop/love-dev", encoding: "utf8" },
    );
    step(`cleanup ${u.email}`, out.includes("RESET COMPLETE"));
  }
  await db.$disconnect();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
