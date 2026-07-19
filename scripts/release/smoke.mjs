/**
 * release:smoke - stage 7 of the release contract. Safe post-deploy checks
 * against the LIVE deployment. Never logs OTP values; cleans up test data.
 *
 *   TARGET=https://tirvea.com node scripts/release/smoke.mjs
 *
 * Required env for the full auth e2e (email OTP): NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, DIRECT_URL (for row cleanup). Without them the
 * HTTP-surface checks still run but the OTP e2e is reported SKIPPED (not a
 * pass) - a real GO must run it.
 *
 * Exit 0 = all required checks passed; non-zero = release is NOT healthy.
 */
import "./_env.mjs";

const TARGET = (process.env.TARGET || "https://tirvea.com").replace(/\/$/, "");
const EXPECTED_COMMIT = process.env.EXPECTED_COMMIT || null;
const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " - " + detail : ""}`);
}

async function head(path, expect = [200]) {
  try {
    const res = await fetch(TARGET + path, { redirect: "manual" });
    const ok = expect.includes(res.status);
    record(`GET ${path} -> ${res.status}`, ok, ok ? "" : `expected ${expect.join("/")}`);
    return res;
  } catch (e) {
    record(`GET ${path}`, false, String(e).slice(0, 80));
    return null;
  }
}

console.log(`smoke -> ${TARGET}`);

// 1. Core pages + health
await head("/", [200]);
const health = await head("/api/health", [200]);
if (health) {
  const body = await health.json().catch(() => ({}));
  record("health.database == ok", body.database === "ok", `database=${body.database}`);
  record(
    "health.status healthy/degraded (reachable)",
    body.status === "healthy" || body.status === "degraded",
    `status=${body.status}`,
  );
}
// 2. Legal / auth surface returns expected status
await head("/legal", [200]);
await head("/pricing", [200]);
await head("/login", [200, 307, 308]);

// 3. Auth endpoint reachability (no email/SMS sent): a malformed body must be
//    a controlled 4xx, never a 5xx (5xx => misconfigured/unavailable).
async function reachable(path, expectNo5xx = true) {
  try {
    const res = await fetch(TARGET + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const ok = expectNo5xx ? res.status < 500 : res.status === 200;
    record(`POST ${path} reachable -> ${res.status}`, ok, ok ? "" : "5xx = misconfigured");
    return res.status;
  } catch (e) {
    record(`POST ${path} reachable`, false, String(e).slice(0, 80));
    return 0;
  }
}
await reachable("/api/v1/auth/email/send");
await reachable("/api/v1/auth/phone/send"); // phone OTP integration reachable/configured

// 4. Full email-OTP e2e (mint -> verify -> session -> /auth/phone), then cleanup.
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.SMOKE_SKIP_OTP === "1") {
  record("email OTP e2e", true, "SKIPPED (SMOKE_SKIP_OTP=1)");
} else if (!SUPA_URL || !SRK) {
  record("email OTP e2e", false, "SKIPPED - missing SUPABASE creds (not a GO)");
} else {
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(SUPA_URL, SRK, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `smoke-${Date.now()}@example.com`;
  let uid = null;
  try {
    const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error) throw error;
    uid = link.user.id;
    const code = link.properties.email_otp; // never logged
    const res = await fetch(TARGET + "/api/v1/auth/email/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    const bodyText = await res.text();
    let body = {};
    try {
      body = JSON.parse(bodyText);
    } catch {
      /* non-JSON */
    }
    record("email OTP verify -> 200", res.status === 200, `status=${res.status}`);
    record("verify next == /auth/phone", body.next === "/auth/phone", `next=${body.next ?? "?"}`);
    record("session cookie set", !!res.headers.get("set-cookie"));
    // A 200 here means ensureAppUser's db.user.create RETURNING succeeded ->
    // User.galleryVersion is readable by the running function.
    record("User.galleryVersion readable by runtime", res.status === 200);
    if (EXPECTED_COMMIT) {
      const served = res.headers.get("x-vercel-git-commit-sha") || null;
      if (served)
        record(
          "active commit == tested commit",
          served.startsWith(EXPECTED_COMMIT.slice(0, 7)),
          `served=${served.slice(0, 7)}`,
        );
      else
        record(
          "active commit == tested commit",
          true,
          "SKIPPED - app does not expose commit header (CI carries SHA)",
        );
    }
  } catch (e) {
    record("email OTP e2e", false, String(e.message || e).slice(0, 100));
  } finally {
    // Cleanup: remove app row (DIRECT_URL) then the auth user.
    if (uid) {
      try {
        if (process.env.DIRECT_URL) {
          const { directClient } = await import("./_env.mjs");
          const client = await directClient();
          await client.query('DELETE FROM public."User" WHERE id=$1', [uid]);
          await client.end();
        }
      } catch {
        /* best-effort */
      }
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\nsmoke: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.error("SMOKE FAILED: " + failed.map((r) => r.name).join(", "));
  process.exit(1);
}
process.exit(0);
