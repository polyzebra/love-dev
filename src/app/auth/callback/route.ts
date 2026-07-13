import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { ensureAppUser } from "@/lib/auth/identity";
import { isFlowStateError } from "@/lib/auth/flow-error";

/**
 * OAuth / magic-link callback. App User rows are created ONLY through
 * ensureAppUser (shared with the email-OTP verify route). Identity is
 * auth.users.id, never email:
 * - blocked identities are rejected before a session survives
 * - a new auth uid is ALWAYS a new account; no email-based adoption,
 *   no automatic resurrection of deleted accounts
 *
 * Idempotent against double-delivery: browsers/mail scanners can hit
 * the callback twice with the same one-time code. The second exchange
 * would fail with flow_state_already_used - so if a session already
 * exists we never exchange again, and an exchange failure with a live
 * session still lands the user where they were going.
 */

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/discover";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/discover";

  const redirect = NextResponse.redirect(new URL(safeNext, url.origin));
  const fail = (err: string) => NextResponse.redirect(new URL(`/login?error=${err}`, url.origin));

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

  // Idempotency guard: a second hit with an already-consumed code from a
  // browser that IS signed in should never exchange again (that's what
  // throws flow_state_already_used). Just continue to the destination.
  const {
    data: { user: existingUser },
  } = await supabase.auth.getUser();
  if (existingUser) return redirect;

  const { data: exchanged, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !exchanged?.user?.email) {
    console.error(`[auth:callback] exchange failed: ${error?.message ?? "no user"}`);
    // The exchange is never retried. If a session materialized anyway
    // (race with another tab), continue; a consumed/stale code without
    // a session gets friendly "link expired" copy, not a scary error.
    const {
      data: { user: sessionUser },
    } = await supabase.auth.getUser();
    if (sessionUser) return redirect;
    return fail(isFlowStateError(error) ? "LinkExpired" : "OAuthCallbackError");
  }

  const result = await ensureAppUser(exchanged.user, { req: request });
  if (!result.ok) {
    await supabase.auth.signOut().catch(() => {});
    if (result.reason === "conflict") return fail("AccountConflict");
    // blocked + suspended: terminate the session before it exists anywhere
    const blocked = NextResponse.redirect(new URL("/login?error=AccountBlocked", url.origin));
    request.cookies
      .getAll()
      .filter((c) => c.name.startsWith("sb-"))
      .forEach((c) => blocked.cookies.delete(c.name));
    return blocked;
  }

  return redirect;
}
