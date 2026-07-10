import { cache } from "react";
import { db } from "@/lib/db";
import { supabaseServer } from "@/lib/supabase/server";
import { isIdentityBlocked } from "@/lib/auth/identity";
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
  // getUser() validates the JWT against Supabase Auth - source of truth
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
  const appUser = await db.user.findUnique({ where: { id: user.id } });
  const blocked = appUser ? false : user.email ? await isIdentityBlocked(user.email) : false;
  if (!appUser || blocked || appUser.status === "SUSPENDED" || appUser.status === "DELETED") {
    console.warn(`[auth:guard] invalid app user for auth.uid=${user.id} - signing out`);
    await supabase.auth.signOut().catch(() => {});
    return null;
  }
  db.user
    .update({ where: { id: user.id }, data: { lastActiveAt: new Date() } })
    .catch(() => {});

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
