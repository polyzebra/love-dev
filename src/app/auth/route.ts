import { NextResponse, type NextRequest } from "next/server";

/**
 * /auth moved permanently to /login (the canonical entry). 308 so
 * bookmarks, password managers and crawlers re-learn the new address.
 *
 * Only SAFE params survive the hop: ?next / ?callbackUrl travel on only
 * when they are same-origin relative paths ("/..." but never "//...").
 * Everything else is dropped - a redirect must never become an
 * open-redirect laundering step.
 */
export function GET(req: NextRequest) {
  const target = new URL("/login", req.url);
  for (const key of ["next", "callbackUrl"] as const) {
    const value = req.nextUrl.searchParams.get(key);
    if (value && value.startsWith("/") && !value.startsWith("//")) {
      target.searchParams.set(key, value);
    }
  }
  return NextResponse.redirect(target, 308);
}
