import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { db } from "@/lib/db";
import { isAuthUserAlive, isIdentityBlocked, recycleDeletedRow, teardownAccount } from "@/lib/auth/identity";

/**
 * OAuth / magic-link callback - the ONLY place an app User row is
 * created. Identity is auth.users.id, never email:
 * - blocked identities are rejected before a session survives
 * - a new auth uid is ALWAYS a new account; no email-based adoption,
 *   no automatic resurrection of deleted accounts
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/discover";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/discover";

  const redirect = NextResponse.redirect(new URL(safeNext, url.origin));
  const fail = (err: string) =>
    NextResponse.redirect(new URL(`/login?error=${err}`, url.origin));

  if (!code) return fail("OAuthCallbackError");

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "anon-key-not-set",
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (all) =>
          all.forEach(({ name, value, options }) => redirect.cookies.set(name, value, options)),
      },
    },
  );

  const { data: exchanged, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !exchanged.user?.email) {
    console.error(`[auth:callback] exchange failed: ${error?.message ?? "no user"}`);
    return fail("OAuthCallbackError");
  }

  const u = exchanged.user;
  const email = u.email!.toLowerCase();
  const provider = (u.app_metadata?.provider as string | undefined) ?? "email";

  // Blocklist gate - terminate the session before it exists anywhere
  if (await isIdentityBlocked(email, provider)) {
    await supabase.auth.signOut().catch(() => {});
    const blocked = NextResponse.redirect(new URL("/login?error=AccountBlocked", url.origin));
    request.cookies
      .getAll()
      .filter((c) => c.name.startsWith("sb-"))
      .forEach((c) => blocked.cookies.delete(c.name));
    return blocked;
  }

  const existing = await db.user.findUnique({ where: { id: u.id } });
  if (existing) {
    // Bans stay banned - but normal deletion is NOT a ban
    if (existing.status === "SUSPENDED") {
      await supabase.auth.signOut().catch(() => {});
      return fail("AccountBlocked");
    }
    if (existing.status === "DELETED") {
      // Tinder-style re-registration: drop the anonymized shell and
      // fall through to a completely fresh account (same auth uid,
      // zero history - onboarding starts from scratch)
      await recycleDeletedRow(existing.id);
    } else {
      // DEACTIVATED = in-app deletion within the grace window:
      // signing in cancels it, as promised at deletion time
      await db.user.update({
        where: { id: u.id },
        data: {
          email,
          lastActiveAt: new Date(),
          ...(existing.status === "DEACTIVATED"
            ? { status: "ACTIVE", deletionRequested: null }
            : {}),
        },
      });
      return redirect;
    }
  }

  // New identity. If a DELETED row still holds this email, tombstone it
  // first - the new account starts empty. An ACTIVE row holding it under
  // a different auth id is an integrity conflict: never merge.
  const emailHolder = await db.user.findUnique({ where: { email } });
  if (emailHolder) {
    if (emailHolder.status === "DELETED") {
      await teardownAccount(emailHolder.id, "email freed for new identity");
    } else if (!(await isAuthUserAlive(emailHolder.id))) {
      // The holder's auth user is gone (dashboard deletion without the
      // webhook) - it's an orphan, not a conflict. Tear it down, free
      // the email, and let the new identity start from zero.
      await teardownAccount(emailHolder.id, "orphaned by auth-user deletion");
    } else {
      console.error(`[identity] conflict: email held by LIVE account ${emailHolder.id}, new auth uid ${u.id}`);
      await supabase.auth.signOut().catch(() => {});
      return fail("AccountConflict");
    }
  }

  await db.user.create({
    data: {
      id: u.id,
      email,
      emailVerified: u.email_confirmed_at ? new Date(u.email_confirmed_at) : null,
      name: (u.user_metadata?.full_name as string | undefined) ?? null,
      image: (u.user_metadata?.avatar_url as string | undefined) ?? null,
    },
  });
  console.info(`[identity] new account auth.uid=${u.id} provider=${provider}`);
  return redirect;
}
