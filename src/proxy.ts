import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PROTECTED = [
  "/discover",
  "/explore",
  "/matches",
  "/notifications",
  "/chat",
  "/messages",
  "/likes",
  "/dashboard",
  "/profile",
  "/settings",
  "/onboarding",
  "/admin",
];

/**
 * /auth and /auth/email-code moved permanently to /login and
 * /login/email/verify. The route handlers under src/app/auth/ already
 * 308; this edge-level normalization is defense-in-depth so cached/PWA
 * clients and any stray server code get corrected before the app even
 * renders. Param carry mirrors the route handlers exactly: only
 * same-origin relative values ("/..." but never "//...") survive for
 * ?next / ?callbackUrl, and only ?email survives onto the verify step.
 */
function legacyAuthRedirect(request: NextRequest): NextResponse | null {
  const { pathname, searchParams } = request.nextUrl;
  if (pathname === "/auth") {
    const target = new URL("/login", request.url);
    for (const key of ["next", "callbackUrl"] as const) {
      const value = searchParams.get(key);
      if (value && value.startsWith("/") && !value.startsWith("//")) {
        target.searchParams.set(key, value);
      }
    }
    return NextResponse.redirect(target, 308);
  }
  if (pathname === "/auth/email-code") {
    const target = new URL("/login/email/verify", request.url);
    const email = searchParams.get("email");
    if (email) target.searchParams.set("email", email);
    return NextResponse.redirect(target, 308);
  }
  return null;
}

/**
 * Edge middleware: refreshes the Supabase session cookie and gates
 * protected routes. Role-level checks (admin) run server-side in the
 * admin layout against the app database.
 */
export default async function proxy(request: NextRequest) {
  const legacy = legacyAuthRedirect(request);
  if (legacy) return legacy;

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "anon-key-not-set",
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (all) => {
          all.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          all.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));

  const { pathname } = request.nextUrl;
  if (!user) {
    // A session cookie that no longer maps to a live Supabase user is
    // dead weight (e.g. the user was deleted in the dashboard). Purge
    // it here - middleware is the one place cookie writes always apply.
    const staleAuthCookies = request.cookies
      .getAll()
      .filter((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));
    if (PROTECTED.some((p) => pathname.startsWith(p))) {
      const login = new URL("/login", request.url);
      login.searchParams.set("callbackUrl", pathname);
      const redirect = NextResponse.redirect(login);
      for (const c of staleAuthCookies) redirect.cookies.delete(c.name);
      return redirect;
    }
    for (const c of staleAuthCookies) response.cookies.delete(c.name);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|avif|ico)).*)",
  ],
};
