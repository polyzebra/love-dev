import { cache } from "react";
import { db } from "@/lib/db";
import { supabaseServer } from "@/lib/supabase/server";
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

  // One-time adoption: a row created by the previous auth system has
  // this email under a different id. Re-key it to the Supabase auth
  // uid so history stays attached to the right person.
  const legacy = await db.user.findUnique({ where: { email: user.email } });
  if (legacy && legacy.id !== user.id) {
    await db.user
      .update({ where: { email: user.email }, data: { id: user.id } })
      .catch(() => {}); // FK references present -> leave as-is; upsert below reports the conflict
  }

  // Ensure the app row exists, keyed by the Supabase auth user id.
  const appUser = await db.user.upsert({
    where: { id: user.id },
    create: {
      id: user.id,
      email: user.email,
      emailVerified: user.email_confirmed_at ? new Date(user.email_confirmed_at) : null,
      name:
        (user.user_metadata?.full_name as string | undefined) ??
        (user.user_metadata?.name as string | undefined) ??
        null,
      image: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    },
    // Keep email in sync with the auth identity; never touch role here
    update: { email: user.email, lastActiveAt: new Date() },
  });

  if (appUser.status === "SUSPENDED" || appUser.status === "DELETED") return null;

  return {
    user: {
      id: appUser.id,
      email: appUser.email,
      name: appUser.name,
      image: appUser.image,
      role: appUser.role,
      onboardingDone: appUser.onboardingDone,
    },
  };
});

/** Server-side helper: current user or null. */
export async function currentUser() {
  return (await auth())?.user ?? null;
}
