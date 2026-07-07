import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { db } from "@/lib/db";

/**
 * OAuth / magic-link callback: exchanges the auth code for a Supabase
 * session, then hands off to the app (the session-join in lib/auth.ts
 * creates the app user row keyed by auth.users.id on first contact).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/discover";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/discover";

  const redirect = NextResponse.redirect(new URL(safeNext, url.origin));

  if (code) {
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
    if (!error && exchanged.user?.email) {
      const u = exchanged.user;
      const email = u.email!;
      // Adopt any legacy row sharing this email, then ensure the app row
      const legacy = await db.user.findUnique({ where: { email } });
      if (legacy && legacy.id !== u.id) {
        await db.user.update({ where: { email }, data: { id: u.id } }).catch(() => {});
      }
      await db.user.upsert({
        where: { id: u.id },
        create: {
          id: u.id,
          email,
          emailVerified: u.email_confirmed_at ? new Date(u.email_confirmed_at) : null,
          name: (u.user_metadata?.full_name as string | undefined) ?? null,
          image: (u.user_metadata?.avatar_url as string | undefined) ?? null,
        },
        update: { email, lastActiveAt: new Date() },
      });
    }
    if (error) {
      console.error(`[auth:callback] exchange failed: ${error.message}`);
      return NextResponse.redirect(new URL("/login?error=OAuthCallbackError", url.origin));
    }
    return redirect;
  }

  return NextResponse.redirect(new URL("/login?error=OAuthCallbackError", url.origin));
}
