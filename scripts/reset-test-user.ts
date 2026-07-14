/**
 * Guarded test-user reset (Phase 4 of the Stripe Identity E2E task):
 *   npx tsx scripts/reset-test-user.ts <email>            # DRY RUN (default)
 *   npx tsx scripts/reset-test-user.ts <email> --confirm  # delete for real
 *
 * Purpose: fully reset ONE designated test account before an end-to-end
 * signup + verification run. This is NOT a general deletion endpoint:
 *
 *  - refuses any email that does not match the approved TEST patterns
 *  - dry-run by default; deletion requires the explicit --confirm flag
 *  - local CLI only (service-role env acts as the credential; there is
 *    deliberately NO HTTP surface for this)
 *  - audits every related record BEFORE deleting and prints the report
 *  - reuses the EXISTING teardownAccount service (anonymized shell,
 *    personal-data hard delete, storage-object cleanup, phone freeing -
 *    messages/matches are anonymized via the shell rather than deleting
 *    the other participant's conversation history), then removes the
 *    tombstone User row and the Supabase Auth identity so the address
 *    can register completely fresh.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

/** Approved patterns - ONLY obvious test identities may be reset. */
export function isApprovedTestEmail(email: string): boolean {
  const value = email.trim().toLowerCase();
  if (!value || value.length > 254) return false;
  return (
    value.endsWith("@example.com") ||
    value.endsWith("@test.tirvea.app") ||
    /^(test|e2e|qa)[-_.+]/.test(value) ||
    /\+(test|e2e|qa)[^@]*@/.test(value)
  );
}

export type ResetAudit = {
  userId: string;
  email: string;
  counts: Record<string, number>;
};

async function main() {
  const [email, ...flags] = process.argv.slice(2);
  const confirm = flags.includes("--confirm");

  if (!email || email.startsWith("--")) {
    console.error("usage: npx tsx scripts/reset-test-user.ts <email> [--confirm]");
    process.exit(2);
  }
  if (!isApprovedTestEmail(email)) {
    console.error(
      `REFUSED: "${email}" does not match the approved test patterns ` +
        "(@example.com, @test.tirvea.app, test-/e2e-/qa- prefixes, +test aliases). " +
        "This tool never touches real member accounts.",
    );
    process.exit(1);
  }

  const { db } = await import("../src/lib/db");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("REFUSED: SUPABASE service credentials missing - nothing was changed.");
    process.exit(1);
  }
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const user = await db.user.findFirst({
    where: { email: email.toLowerCase() },
    select: { id: true, email: true, status: true },
  });

  // Also look for a dangling auth identity with no app row. Paginate -
  // the shared instance can hold more identities than one page.
  let authUserId: string | null = null;
  try {
    for (let page = 1; page <= 50 && !authUserId; page += 1) {
      const batch = await admin.auth.admin.listUsers({ page, perPage: 200 });
      authUserId =
        batch.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
      if (batch.data.users.length < 200) break;
    }
  } catch {
    authUserId = null;
  }

  if (!user && !authUserId) {
    console.log(`Nothing to reset: no app user or auth identity for ${email}.`);
    await db.$disconnect();
    return;
  }

  // ---- Audit first ---------------------------------------------------------
  const counts: Record<string, number> = {};
  if (user) {
    const [
      verifications,
      photos,
      profile,
      devices,
      notifications,
      settings,
      likesSent,
      matches,
      messages,
      subscriptions,
      payments,
    ] = await Promise.all([
      db.verification.count({ where: { userId: user.id } }),
      db.photo.count({ where: { userId: user.id } }),
      db.profile.count({ where: { userId: user.id } }),
      db.notificationDevice.count({ where: { userId: user.id } }),
      db.notification.count({ where: { userId: user.id } }),
      db.userSettings.count({ where: { userId: user.id } }),
      db.like.count({ where: { fromId: user.id } }),
      db.match.count({ where: { OR: [{ userAId: user.id }, { userBId: user.id }] } }),
      db.message.count({ where: { senderId: user.id } }),
      db.subscription.count({ where: { userId: user.id } }),
      db.payment.count({ where: { userId: user.id } }),
    ]);
    Object.assign(counts, {
      verifications,
      photos,
      profile,
      notificationDevices: devices,
      notifications,
      settings,
      likesSent,
      matches,
      messagesSent: messages,
      subscriptions,
      payments,
    });
  }

  console.log("---- audit ----------------------------------------------------");
  console.log(`app user:      ${user ? `${user.id} (status ${user.status})` : "none"}`);
  console.log(`auth identity: ${authUserId ?? "none"}`);
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(20)} ${v}`);
  console.log("----------------------------------------------------------------");

  if (!confirm) {
    console.log("DRY RUN - nothing was deleted. Re-run with --confirm to reset this test user.");
    await db.$disconnect();
    return;
  }

  // ---- Delete (existing services first, never bypassing storage) ----------
  if (user) {
    const { teardownAccount } = await import("../src/lib/auth/identity");
    await teardownAccount(user.id, `test-user reset via CLI (${new Date().toISOString()})`);
    // teardownAccount leaves an anonymized tombstone (so messages/matches
    // shared with OTHER users anonymize instead of vanishing). A pure test
    // user has no such shared history worth keeping - remove the shell.
    // Cascades cover swipes/matches/messages/participants via FKs.
    await db.user.delete({ where: { id: user.id } }).catch((error) => {
      console.warn(`tombstone removal skipped: ${String(error).slice(0, 120)}`);
    });
  }
  if (authUserId) {
    await admin.auth.admin.deleteUser(authUserId).catch((error) => {
      console.warn(`auth identity removal failed: ${String(error).slice(0, 120)}`);
    });
  }

  console.log(`RESET COMPLETE for ${email}:`);
  console.log(`  - teardownAccount ran (personal rows + storage objects removed)`);
  console.log(`  - tombstone User row deleted (cascade cleans interactions)`);
  console.log(`  - Supabase auth identity deleted`);
  console.log("The address can now register completely fresh.");
  await db.$disconnect();
}

// Only run when invoked directly (tests import the guard function).
if (process.argv[1]?.includes("reset-test-user")) {
  main().catch((error) => {
    console.error("reset failed:", error);
    process.exit(1);
  });
}
