import { cache } from "react";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { supabaseServer } from "@/lib/supabase/server";
import { isIdentityBlocked } from "@/lib/auth/identity";
import { decideIdentity, parseAuthorizationHeader } from "@/lib/auth/transport";
import type { Role } from "@/generated/prisma/enums";

/**
 * Supabase-backed session, same shape the app has always consumed:
 * `auth()` returns { user: { id, email, role, onboardingDone } } | null.
 *
 * `auth()` IS the canonical-user resolver (resolveCanonicalUser by any
 * other name): identity is the Supabase auth user id (auth.users.id) -
 * NEVER email or display name. The app row in our User table is keyed by
 * that id (single findUnique on User.id, no email-primary lookup), so two
 * Google accounts can never resolve to one profile, and it fails safe: a
 * session whose app row is missing/suspended/deleted is signed out on the
 * spot. Do not build a second resolver - extend this one.
 */

export type AppSession = {
  user: {
    id: string;
    /** Always set on the app row - phone-keyed accounts carry a placeholder until they add one. */
    email: string;
    name: string | null;
    image: string | null;
    role: Role;
    onboardingDone: boolean;
    /** Supabase sign-in provider for THIS session ("email", "google", "phone", ...) - diagnostics only. */
    provider: string | null;
    /** ALL providers linked to this auth user (session app_metadata.providers), e.g. ["email","google"]. */
    linkedProviders: string[];
    /** The app account status ("ACTIVE", "DEACTIVATED", ...) - same value as `status`, spec-named. */
    accountStatus: string;
    // Gate inputs (see src/lib/auth/gate.ts)
    status: string;
    bannedAt: Date | null;
    emailVerified: Date | null;
    phoneVerifiedAt: Date | null;
    ageConfirmedAt: Date | null;
    termsVersion: string | null;
    privacyVersion: string | null;
    communityVersion: string | null;
    authCompleted: boolean;
  };
};

export const auth = cache(async (): Promise<AppSession | null> => {
  const supabase = await supabaseServer();

  // ---- Transport resolution (ONE canonical boundary) -----------------
  // Two transports resolve to the same principal: the browser's Supabase
  // SSR cookies (unchanged) and `Authorization: Bearer <access token>`
  // for native/API clients. Every verification goes through Supabase
  // Auth (`getUser`), which checks signature, expiry and revocation
  // server-side - token contents are never decoded or logged locally.
  // The decision rules (malformed rejects, conflicting identities
  // reject, matching identities proceed) live in lib/auth/transport.ts.
  const bearer = parseAuthorizationHeader((await headers()).get("authorization"));
  if (bearer.kind === "malformed") return null;

  const cookieStore = await cookies();
  const hasCookieCredentials = cookieStore
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));

  const t0 = Date.now();
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  let transport: "cookie" | "bearer" = "cookie";

  if (bearer.kind === "token") {
    const bearerRes = await supabase.auth.getUser(bearer.token);
    const bearerUser = bearerRes.data.user;
    // Conflict check only when cookie credentials also exist.
    let cookieUserId: string | null = null;
    if (hasCookieCredentials && bearerUser?.id) {
      const cookieRes = await supabase.auth.getUser().catch(() => null);
      cookieUserId = cookieRes?.data.user?.id ?? null;
    }
    const decision = decideIdentity({
      bearer,
      bearerUserId: bearerUser?.id ?? null,
      cookieUserId,
      hasCookieCredentials,
    });
    if (!decision.ok) {
      // Observability (Phase 0M): rejection REASON only - never token
      // material, never identifiers. Request logs correlate by line.
      console.warn(`[auth] transport=bearer rejected reason=${decision.reason}`);
      return null;
    }
    user = bearerUser;
    transport = "bearer";
  } else {
    // getUser() validates the cookie JWT against Supabase Auth.
    const cookieRes = await supabase.auth.getUser();
    user = cookieRes.data.user;
  }

  if (process.env.PERF_TRACE) {
    console.info(`[trace:auth] getUser ${Date.now() - t0}ms at=${Date.now()}`);
  }
  // Phone-keyed auth users (native phone OTP login) have NO email - only
  // require the uid. Email-keyed sessions still carry one.
  if (!user?.id) return null;

  console.info(
    `[auth:session] provider=${user.app_metadata?.provider ?? "?"} auth.uid=${user.id} email=${user.email ?? "(phone-keyed)"}`,
  );

  // Pure verification - the app row is created ONLY in /auth/callback,
  // the email-OTP verify route or the phone-login verify route.
  // A session whose app user vanished (deleted account, revoked access)
  // is terminated on the spot: sign out, clear cookies, return null.
  //
  // SUSPENDED/BANNED sessions deliberately SURVIVE (trust & safety
  // milestone): the gate routes them to the status area (/account-blocked)
  // where they can read their violations and appeal. They stay locked out
  // of everything else centrally:
  //  - pages: requireUser -> authNextStep -> /account-blocked
  //  - APIs:  requireSession answers 403 account_restricted (lib/api.ts)
  //  - admin: getCurrentAdmin requires status ACTIVE
  // NEW logins for banned/suspended accounts remain rejected at the login
  // flows (ensureAppUser / provisionPhoneLoginUser) - an existing session
  // may read status + appeal, but a restricted account cannot mint fresh
  // sessions.
  const appUser = await db.user.findUnique({ where: { id: user.id } });
  const blocked = appUser ? false : user.email ? await isIdentityBlocked(user.email) : false;
  if (!appUser || blocked || appUser.status === "DELETED") {
    console.warn(`[auth:guard] invalid app user for auth.uid=${user.id} - rejecting`);
    // Cookie cleanup belongs to the cookie transport ONLY: a bearer
    // request must never sign out (mutate) whatever cookie session the
    // same browser/agent may hold.
    if (transport === "cookie") await supabase.auth.signOut().catch(() => {});
    return null;
  }
  db.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } }).catch(() => {});

  return {
    user: {
      id: appUser.id,
      email: appUser.email,
      name: appUser.name,
      image: appUser.image,
      role: appUser.role,
      onboardingDone: appUser.onboardingDone,
      provider: (user.app_metadata?.provider as string | undefined) ?? null,
      linkedProviders: Array.isArray(user.app_metadata?.providers)
        ? (user.app_metadata.providers as string[])
        : [],
      accountStatus: appUser.status,
      status: appUser.status,
      bannedAt: appUser.bannedAt,
      emailVerified: appUser.emailVerified,
      phoneVerifiedAt: appUser.phoneVerifiedAt,
      ageConfirmedAt: appUser.ageConfirmedAt,
      termsVersion: appUser.termsVersion,
      privacyVersion: appUser.privacyVersion,
      communityVersion: appUser.communityVersion,
      authCompleted: appUser.authCompleted,
    },
  };
});

/** Server-side helper: current user or null. */
export async function currentUser() {
  return (await auth())?.user ?? null;
}
