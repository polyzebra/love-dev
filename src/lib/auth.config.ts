import type { NextAuthConfig } from "next-auth";
import type { Role } from "@/generated/prisma/enums";
import Google from "next-auth/providers/google";
import Apple from "next-auth/providers/apple";

/**
 * Edge-safe Auth.js configuration — no database imports.
 * The middleware (proxy) uses this to gate routes; the full server
 * config in `auth.ts` layers the Prisma adapter and credentials on top.
 */
export const authConfig = {
  pages: {
    signIn: "/login",
    newUser: "/onboarding",
  },
  session: { strategy: "jwt", maxAge: 30 * 24 * 3600 },
  providers: [
    Google({
      allowDangerousEmailAccountLinking: false,
    }),
    Apple,
  ],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const loggedIn = !!auth?.user;

      const isProtected =
        pathname.startsWith("/discover") ||
        pathname.startsWith("/matches") ||
        pathname.startsWith("/chat") ||
        pathname.startsWith("/profile") ||
        pathname.startsWith("/settings") ||
        pathname.startsWith("/onboarding") ||
        pathname.startsWith("/admin");

      if (isProtected && !loggedIn) return false; // redirects to signIn page

      if (pathname.startsWith("/admin")) {
        const role = auth?.user?.role;
        return role === "ADMIN" || role === "MODERATOR";
      }

      return true;
    },
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.onboardingDone = user.onboardingDone;
      }
      if (trigger === "update" && session) {
        // Allow client-driven refresh after onboarding completes
        token.onboardingDone = session.onboardingDone ?? token.onboardingDone;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = (token.role as Role) ?? "USER";
        session.user.onboardingDone = Boolean(token.onboardingDone);
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
