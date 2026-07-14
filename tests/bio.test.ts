/**
 * Bio feature tests (end to end over the v1 API + source-contract pins):
 *   npx tsx tests/bio.test.ts
 *
 * Live lane: real Supabase credentials + the dev server on :3000 (route
 * checks skip with a notice when unreachable). Covers:
 *  - unauthenticated update rejection
 *  - successful update / whitespace trimming / 500 boundary / >500 reject
 *  - clearing stores NULL (both "" and explicit null)
 *  - a bio-only PATCH never clobbers unrelated fields or prompts (the
 *    latent partial-update wipe this feature's audit uncovered)
 *  - source pins: "Write yours" and the Edit affordance open
 *    /profile/bio (never a generic settings page), owner empty/saved
 *    states, expanded-profile display, no empty bio section anywhere
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

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
const src = (...parts: string[]) => readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");

async function main() {
  console.log("bio: source contracts");

  check("'Write yours' and Edit both open /profile/bio, never settings", () => {
    const page = src("app", "(app)", "profile", "page.tsx");
    const bioCard = page.slice(page.indexOf("In my words"), page.indexOf("Answer prompts"));
    assert.ok(page.includes('href="/profile/bio"'), "editor route linked");
    assert.equal(
      (page.match(/href="\/profile\/bio"/g) ?? []).length,
      2,
      "both the empty card and the Edit affordance",
    );
    assert.ok(!bioCard.includes('href="/settings"'), "generic settings redirect removed");
  });

  check("owner page: empty state XOR saved bio (never both, never an empty section)", () => {
    const page = src("app", "(app)", "profile", "page.tsx");
    assert.ok(/\{profile\.bio \? \(/.test(page), "conditional render on profile.bio");
    assert.ok(page.includes("No bio yet"), "empty-state card kept for null bios");
    assert.ok(page.includes("whitespace-pre-wrap"), "line breaks preserved as plain text");
  });

  check("editor page: back button, title, label, counter, clear", () => {
    const page = src("app", "(app)", "profile", "bio", "page.tsx");
    const form = src("app", "(app)", "profile", "bio", "bio-form.tsx");
    assert.ok(page.includes("Back to profile") && page.includes("About me"));
    assert.ok(form.includes('htmlFor="bio"'), "accessible label");
    assert.ok(form.includes("BIO_MAX_LENGTH"), "counter bound to the canonical cap");
    assert.ok(form.includes("Clear"), "clear support");
    assert.ok(form.includes('role="alert"'), "accessible error messaging");
    assert.ok(!form.includes("dangerouslySetInnerHTML"), "plain text only");
  });

  check("expanded profile surfaces render bio only when present", () => {
    const peek = src("components", "app", "profile-peek.tsx");
    assert.ok(peek.includes("profile.bio && ("), "peek hides empty bio");
    const viewer = src("components", "explore", "profile-viewer.tsx");
    assert.ok(viewer.includes("profile.bio && ("), "explore viewer hides empty bio");
  });

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
    skip("bio API checks", "dev server not running");
    await db.$disconnect();
    console.log(`\n${passed} checks passed`);
    return;
  }

  const email = `bio-${RUN}@example.com`;
  const password = `bio-test-${RUN}-Aa1!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const uid = created.data.user!.id;
  const now = new Date();
  await db.user.create({
    data: {
      id: uid,
      email,
      name: "Bio Tester",
      emailVerified: now,
      phone: `+3538791${RUN.slice(-5)}`,
      phoneVerifiedAt: now,
      ageConfirmedAt: now,
      termsVersion: "2026-07",
      privacyVersion: "2026-07",
      communityVersion: "2026-07",
      onboardingDone: true,
    },
  });
  const profile = await db.profile.create({
    data: {
      userId: uid,
      displayName: "Bio Tester",
      birthDate: new Date("1994-04-04"),
      gender: "WOMAN",
      languages: ["English", "Latvian"],
      prompts: {
        create: [{ promptKey: "green-flags", answer: "Kindness", sortOrder: 0 }],
      },
    },
  });
  const anon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const token = (await anon.auth.signInWithPassword({ email, password })).data.session!
    .access_token;

  const patch = (body: unknown, auth = true) =>
    fetch(`${BASE}/api/v1/profile`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  try {
    console.log("bio: API behavior, live");

    await check("unauthenticated update -> 401 with the standard envelope", async () => {
      const res = await patch({ bio: "nope" }, false);
      assert.equal(res.status, 401);
      const body = (await res.json()) as { error?: { code?: string } };
      assert.equal(body.error?.code, "unauthorized");
    });

    await check("successful update persists and echoes the bio", async () => {
      const res = await patch({ bio: "Sea swims and slow mornings." });
      assert.equal(res.status, 200);
      const row = await db.profile.findUniqueOrThrow({ where: { id: profile.id } });
      assert.equal(row.bio, "Sea swims and slow mornings.");
    });

    await check("whitespace is trimmed server-side", async () => {
      const res = await patch({ bio: "   Honest lines only.  \n " });
      assert.equal(res.status, 200);
      const row = await db.profile.findUniqueOrThrow({ where: { id: profile.id } });
      assert.equal(row.bio, "Honest lines only.");
    });

    await check("exactly 500 characters is accepted", async () => {
      const bio = "x".repeat(500);
      const res = await patch({ bio });
      assert.equal(res.status, 200);
      const row = await db.profile.findUniqueOrThrow({ where: { id: profile.id } });
      assert.equal(row.bio?.length, 500);
    });

    await check("501 characters is rejected server-side (422)", async () => {
      const res = await patch({ bio: "x".repeat(501) });
      assert.equal(res.status, 422);
      const body = (await res.json()) as { error?: { code?: string } };
      assert.equal(body.error?.code, "validation_error");
      const row = await db.profile.findUniqueOrThrow({ where: { id: profile.id } });
      assert.equal(row.bio?.length, 500, "rejected payload changed nothing");
    });

    await check("clearing stores NULL - explicit null and empty string alike", async () => {
      assert.equal((await patch({ bio: null })).status, 200);
      let row = await db.profile.findUniqueOrThrow({ where: { id: profile.id } });
      assert.equal(row.bio, null);
      await patch({ bio: "back again" });
      assert.equal((await patch({ bio: "   " })).status, 200);
      row = await db.profile.findUniqueOrThrow({ where: { id: profile.id } });
      assert.equal(row.bio, null, "whitespace-only folds to null too");
    });

    await check("a bio-only PATCH never clobbers other fields or prompts", async () => {
      await patch({ bio: "Just the bio, please." });
      const row = await db.profile.findUniqueOrThrow({
        where: { id: profile.id },
        include: { prompts: true },
      });
      assert.deepEqual(row.languages, ["English", "Latvian"], "languages untouched");
      assert.equal(row.prompts.length, 1, "prompt answers untouched");
      assert.equal(row.displayName, "Bio Tester");
    });

    await check("over-posting is rejected: unknown/private fields never pass", async () => {
      const res = await patch({ bio: "hi", userId: "someone-else", role: "ADMIN" });
      assert.equal(res.status, 422, "strict schema refuses unknown keys");
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    await db.user.delete({ where: { id: uid } }).catch(() => {});
    await admin.auth.admin.deleteUser(uid).catch(() => {});
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("\nFAILED:", error);
  process.exitCode = 1;
});
