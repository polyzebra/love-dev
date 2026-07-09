import { cache } from "react";
import { db } from "@/lib/db";
import { supabaseServer } from "@/lib/supabase/server";
import { isIdentityBlocked } from "@/lib/auth/identity";
import type { Role } from "@/generated/prisma/enums";

/**
 * Supabase-backed session, same shape the app has always consumed:
 * `auth()` returns { user: { id, email, role, onboardingDone } } | null.
 *
 * Identity is the Supabase auth user id (auth.users.id) - NEVER email
 * or display name. The app row in our User table is keyed by that id,
 * so two Google accounts can never resolve to one profile.
 */

export type AppSession = {
  user: {
    id: string;
    email: string;
    name: string | null;
    image: string | null;
    role: Role;
    onboardingDone: boolean;
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
  if (!user?.email) return null;

  console.info(
    `[auth:session] provider=${user.app_metadata?.provider ?? "?"} auth.uid=${user.id} email=${user.email}`,
  );

  // Pure verification - the app row is created ONLY in /auth/callback.
  // A session whose app user vanished (deleted account, revoked access)
  // is terminated on the spot: sign out, clear cookies, return null.
  const appUser = await db.user.findUnique({ where: { id: user.id } });
  const blocked = appUser ? false : await isIdentityBlocked(user.email);
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
