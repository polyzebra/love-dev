import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

/**
 * Edge middleware: session gating for app/admin routes.
 * Route rules live in the `authorized` callback in auth.config.ts;
 * security headers are set globally in next.config.ts.
 */
export default NextAuth(authConfig).auth;

export const config = {
  // Skip API routes, static assets and Next internals
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|avif|ico)).*)",
  ],
};
