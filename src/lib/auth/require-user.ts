import { redirect } from "next/navigation";
import { auth, type AppSession } from "@/lib/auth";
import { authNextStep } from "@/lib/auth/gate";

/**
 * Central server guard for protected pages. Verifies, in order:
 * Supabase session -> Supabase auth user still exists (getUser hits the
 * auth server, so dashboard-deleted users fail here) -> app User row
 * exists -> not suspended/deleted. Any failure signs the session out
 * (inside auth()) and redirects to /login. Never trusts a stale
 * client-side session.
 *
 * On top of that the auth gate runs: users who still owe a step
 * (email/phone verification, onboarding) are sent to it. A page that IS
 * a step passes itself as `allow` so it can render (e.g. the onboarding
 * page calls requireUser({ allow: "/onboarding" })).
 */
export async function requireUser(opts?: { allow?: string }): Promise<AppSession["user"]> {
  const session = await auth();
  if (!session) redirect("/login");
  const next = authNextStep(session.user);
  if (next !== "/discover" && next !== opts?.allow) redirect(next);
  return session.user;
}

/** Admin gate: everything requireUser does, plus role. */
export async function requireAdmin(): Promise<AppSession["user"]> {
  const user = await requireUser();
  if (user.role !== "ADMIN" && user.role !== "MODERATOR") redirect("/discover");
  return user;
}
