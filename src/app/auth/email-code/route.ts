import { NextResponse, type NextRequest } from "next/server";

/**
 * /auth/email-code moved permanently to /login/email/verify. 308 with
 * the ?email carrier preserved (it is the screen's primary state - the
 * sessionStorage fallback only covers stripped params). Nothing else
 * survives the hop.
 */
export function GET(req: NextRequest) {
  const target = new URL("/login/email/verify", req.url);
  const email = req.nextUrl.searchParams.get("email");
  if (email) target.searchParams.set("email", email);
  return NextResponse.redirect(target, 308);
}
