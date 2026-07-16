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
 *
 * Auth check strategy (cost matters - this runs on EVERY navigation and
 * every prefetch): `getClaims()` verifies the ES256 session JWT locally
 * against the project JWKS (fetched once per instance, cached 10 min by
 * auth-js), so a warm navigation costs ZERO auth network calls here. An
 * EXPIRED access token still refreshes over the network inside
 * getClaims() -> getSession(), and middleware remains the one place that
 * refresh reliably writes cookies. Deep user validation (auth user still
 * exists, app row active) stays where it always was: server-side
 * `auth()` via requireUser on every protected page - a deleted user's
 * still-valid JWT passes here but is signed out there, and once its
 * refresh fails this middleware purges the cookies.
 */
/** Client-supplied correlation ids are honored when well-formed. */
const REQUEST_ID_SHAPE = /^[A-Za-z0-9._-]{8,64}$/;

export default async function proxy(request: NextRequest) {
  // ---- API paths: correlation stamp ONLY --------------------------------
  // The matcher now includes /api solely so every API request/response
  // carries an X-Request-Id (client-supplied when well-formed, generated
  // otherwise). No auth, cookie or redirect logic runs for API paths -
  // API authentication stays in the route handlers (lib/api.ts), exactly
  // as before this branch existed.
  if (request.nextUrl.pathname.startsWith("/api")) {
    const supplied = request.headers.get("x-request-id");
    const id = supplied && REQUEST_ID_SHAPE.test(supplied) ? supplied : crypto.randomUUID();
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-request-id", id);
    const apiResponse = NextResponse.next({ request: { headers: requestHeaders } });
    apiResponse.headers.set("x-request-id", id);
    return apiResponse;
  }

  const legacy = legacyAuthRedirect(request);
  if (legacy) return legacy;

  let response = NextResponse.next({ request });

  const { pathname } = request.nextUrl;
  const authCookies = request.cookies
    .getAll()
    .filter((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));
  const isProtected = PROTECTED.some((p) => pathname.startsWith(p));

  // No session cookie: nothing to validate, nothing to purge.
  if (authCookies.length === 0) {
    if (isProtected) {
      const login = new URL("/login", request.url);
      login.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(login);
    }
    return response;
  }

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

  const t0 = Date.now();
  const claims = await supabase.auth
    .getClaims()
    .then(({ data }) => data?.claims ?? null)
    .catch(() => null);
  if (process.env.PERF_TRACE) {
    console.info(`[trace:mw] getClaims ${Date.now() - t0}ms path=${pathname} at=${Date.now()}`);
  }

  if (!claims) {
    // A session cookie that no longer verifies or refreshes is dead
    // weight (expired + revoked, e.g. the user was deleted in the
    // dashboard). Purge it here - middleware is the one place cookie
    // writes always apply.
    if (isProtected) {
      const login = new URL("/login", request.url);
      login.searchParams.set("callbackUrl", pathname);
      const redirect = NextResponse.redirect(login);
      for (const c of authCookies) redirect.cookies.delete(c.name);
      return redirect;
    }
    for (const c of authCookies) response.cookies.delete(c.name);
    return response;
  }

  // NOTE: /login is deliberately NOT reverse-gated here. A signed-in
  // visitor must be able to reach the front door so it can offer the
  // recovery view (continue setup / use another account / sign out) - see
  // resolveLoginView() in lib/auth/gate.ts. Previously this edge redirect
  // sent every signed-in visitor to /discover, which re-gated an
  // incompletely-onboarded account straight to /auth/email, making the
  // login chooser unreachable and trapping partial phone-first accounts.
  // The page renders (never edge-redirects) for authenticated users, so
  // the old empty-slot frame does not recur; only a restricted account is
  // redirected, page-side, to its status area.

  return response;
}

export const config = {
  // /api is INCLUDED for the correlation-id stamp branch above (which
  // returns before any auth logic); pages keep the full session flow.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|avif|ico)).*)",
  ],
};
