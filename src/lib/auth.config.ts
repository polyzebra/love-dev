import type { NextAuthConfig } from "next-auth";
import type { Role } from "@/generated/prisma/enums";
import Google from "next-auth/providers/google";
import Apple from "next-auth/providers/apple";
import { SignJWT, importPKCS8 } from "jose";
import { appleConfig, googleConfig } from "@/lib/oauth";

/**
 * Providers are registered only when fully configured - an empty
 * GOOGLE_CLIENT_ID can never reach Google's consent screen and fail
 * with "Missing required parameter: client_id".
 */
const oauthProviders: NextAuthConfig["providers"] = [];

if (googleConfig) {
  oauthProviders.push(
    Google({
      clientId: googleConfig.clientId,
      clientSecret: googleConfig.clientSecret,
      allowDangerousEmailAccountLinking: false,
    }),
  );
}

if (appleConfig) {
  oauthProviders.push(
    Apple({
      clientId: appleConfig.clientId,
      clientSecret:
        appleConfig.clientSecret ??
        // Mint Apple's client-secret JWT from the signing inputs (ES256,
        // max 6 months). Runs once at boot; edge-safe via jose.
        (await (async () => {
          const key = await importPKCS8(
            appleConfig.privateKey!.replace(/\\n/g, "\n"),
            "ES256",
          );
          return new SignJWT({})
            .setProtectedHeader({ alg: "ES256", kid: appleConfig.keyId! })
            .setIssuer(appleConfig.teamId!)
            .setIssuedAt()
            .setExpirationTime("180days")
            .setAudience("https://appleid.apple.com")
            .setSubject(appleConfig.clientId)
            .sign(key);
        })()),
    }),
  );
}

/**
 * Edge-safe Auth.js configuration - no database imports.
 * The middleware (proxy) uses this to gate routes; the full server
 * config in `auth.ts` layers the Prisma adapter and credentials on top.
 */
export const authConfig = {
  // Required for self-hosted deployments (Auth.js v5). The reverse proxy /
  // platform in front of the app must set the Host header correctly.
  trustHost: true,
  pages: {
    signIn: "/login",
    error: "/login", // Auth.js errors surface as clean toasts on our login page
    newUser: "/onboarding",
  },
  session: { strategy: "jwt", maxAge: 30 * 24 * 3600 },
  providers: oauthProviders,
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const loggedIn = !!auth?.user;

      const isProtected = [
        "/discover",
        "/matches",
        "/chat",
        "/messages",
        "/likes",
        "/dashboard",
        "/profile",
        "/settings",
        "/onboarding",
        "/admin",
      ].some((p) => pathname.startsWith(p));

      if (isProtected && !loggedIn) return false; // redirects to signIn page

      if (pathname.startsWith("/admin")) {
        const role = auth?.user?.role;
        if (role === "ADMIN" || role === "MODERATOR") return true;
        // Signed-in but not staff: send home rather than to the login page
        return Response.redirect(new URL("/discover", request.nextUrl));
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
