import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PROTECTED = [
  "/discover",
  "/explore",
  "/matches",
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
 * Edge middleware: refreshes the Supabase session cookie and gates
 * protected routes. Role-level checks (admin) run server-side in the
 * admin layout against the app database.
 */
export default async function proxy(request: NextRequest) {
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
