import { redirect } from "next/navigation";
import { auth, type AppSession } from "@/lib/auth";

/**
 * Central server guard for protected pages. Verifies, in order:
 * Supabase session -> Supabase auth user still exists (getUser hits the
 * auth server, so dashboard-deleted users fail here) -> app User row
 * exists -> not suspended/deleted. Any failure signs the session out
 * (inside auth()) and redirects to /login. Never trusts a stale
 * client-side session.
 */
export async function requireUser(): Promise<AppSession["user"]> {
  const session = await auth();
  if (!session) redirect("/login");
  return session.user;
}

/** Admin gate: everything requireUser does, plus role. */
export async function requireAdmin(): Promise<AppSession["user"]> {
  const user = await requireUser();
  if (user.role !== "ADMIN" && user.role !== "MODERATOR") redirect("/discover");
  return user;
}
