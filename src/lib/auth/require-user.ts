import { redirect } from "next/navigation";
import { auth, type AppSession } from "@/lib/auth";
import { authNextStep } from "@/lib/auth/gate";
import { isStaff, isSuperAdmin } from "@/lib/rbac";

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

/**
 * SINGLE SOURCE for admin-area authorization. Every admin gate - the
 * /admin layout, admin pages, admin API routes (via lib/api.ts
 * requirePermission, which layers per-permission checks on top) - resolves
 * the actor through auth() and role-checks through rbac helpers. Do not
 * write ad-hoc `role === "..."` checks; add a permission to rbac.ts or a
 * tier here.
 *
 * Returns a discriminated result instead of redirecting so callers can
 * choose the spec'd failure surface: pages redirect unauthenticated users
 * to /login and RENDER a 403 Access Denied page for authenticated
 * non-admins (no redirect away); API routes answer 401/403.
 *
 * Suspended/banned accounts never reach the role check: auth() refuses to
 * mint a session for SUSPENDED/DELETED rows (signs them out), so an
 * inactive admin resolves to "unauthenticated". The explicit status check
 * below is defense in depth should auth() ever loosen.
 */
export type AdminGate =
  | { ok: true; user: AppSession["user"] }
  | { ok: false; reason: "unauthenticated" | "forbidden" };

export async function getCurrentAdmin(tier: "staff" | "super" = "staff"): Promise<AdminGate> {
  const session = await auth();
  if (!session) return { ok: false, reason: "unauthenticated" };
  const { user } = session;
  if (user.status !== "ACTIVE") return { ok: false, reason: "forbidden" };
  const allowed = tier === "super" ? isSuperAdmin(user.role) : isStaff(user.role);
  if (!allowed) return { ok: false, reason: "forbidden" };
  return { ok: true, user };
}

/**
 * Guard for every page in the /admin segment. REQUIRED in each page even
 * though the layout also gates: Next renders segment pages in parallel
 * with their layout, so a page that queries without its own gate would
 * stream its RSC payload to a forbidden visitor even while the layout
 * shows Access Denied (proven by tests/admin-authz.test.ts "dashboard
 * data must not leak").
 *
 * Returns the admin user, or null after the layout has taken over:
 * unauthenticated visitors are redirected to /login here; forbidden ones
 * get null and the page MUST `return null` immediately - the layout is
 * already rendering the 403 Access Denied page in its place.
 */
export async function requireAdminPage(
  tier: "staff" | "super" = "staff",
): Promise<AppSession["user"] | null> {
  const gate = await getCurrentAdmin(tier);
  if (gate.ok) return gate.user;
  if (gate.reason === "unauthenticated") redirect("/login");
  return null;
}

/** Admin gate for standalone pages: everything requireUser does, plus role. */
export async function requireAdmin(): Promise<AppSession["user"]> {
  const gate = await getCurrentAdmin();
  if (gate.ok) return gate.user;
  redirect(gate.reason === "unauthenticated" ? "/login" : "/discover");
}

/** SUPER_ADMIN gate for standalone pages (see requireAdminPage for /admin segment pages). */
export async function requireSuperAdmin(): Promise<AppSession["user"]> {
  const gate = await getCurrentAdmin("super");
  if (gate.ok) return gate.user;
  redirect(gate.reason === "unauthenticated" ? "/login" : "/discover");
}
