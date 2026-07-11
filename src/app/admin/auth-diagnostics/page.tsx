import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Stethoscope } from "lucide-react";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getCurrentAdmin } from "@/lib/auth/require-user";
import { maskEmail } from "@/lib/phone-mask";
import { normalizeEmail } from "@/lib/services/admin-bootstrap";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { AccessDenied } from "../access-denied";

export const metadata: Metadata = { title: "Auth diagnostics" };
export const dynamic = "force-dynamic";

/**
 * SUPER_ADMIN-only identity self-check for the live deployment: proves
 * WHO the current session resolves to (uid, role, providers, last
 * sign-in) and WHAT the environment has configured - by NAME only.
 * No tokens, no keys, no secret values, ever. Every view is written to
 * AdminLog so diagnostic access itself is auditable.
 */
export default async function AuthDiagnosticsPage() {
  const gate = await getCurrentAdmin("super");
  if (!gate.ok) {
    if (gate.reason === "unauthenticated") redirect("/login");
    // Staff below SUPER_ADMIN land here: calm 403, no redirect away.
    return <AccessDenied message="Auth diagnostics is limited to the SUPER_ADMIN account." />;
  }
  const user = gate.user;

  // auth.users.last_sign_in_at is auth-schema data Prisma has no model
  // for - read it with a single parameterized query.
  const rows = await db.$queryRaw<{ last_sign_in_at: Date | null }[]>`
    SELECT last_sign_in_at FROM auth.users WHERE id = ${user.id}::uuid`;
  const lastSignIn = rows[0]?.last_sign_in_at ?? null;

  await audit({
    actorId: user.id,
    action: "admin.diagnostics.view",
    targetType: "user",
    targetId: user.id,
  });

  const entries: { label: string; value: React.ReactNode; hint?: string }[] = [
    { label: "Auth uid (User.id)", value: <code className="break-all text-xs">{user.id}</code>, hint: "Role is attached to this id - never to the email." },
    { label: "Email (masked)", value: maskEmail(user.email) },
    { label: "Email (normalized)", value: normalizeEmail(user.email) },
    { label: "Role", value: <Badge className="rounded-full">{user.role}</Badge> },
    { label: "Account status", value: user.accountStatus },
    { label: "Session provider", value: user.provider ?? "-" },
    {
      label: "Linked providers",
      value: user.linkedProviders.length > 0 ? user.linkedProviders.join(", ") : "-",
      hint: "app_metadata.providers from the Supabase session.",
    },
    {
      label: "Last sign-in",
      value: lastSignIn ? lastSignIn.toISOString() : "-",
      hint: "auth.users.last_sign_in_at",
    },
    { label: "NODE_ENV", value: process.env.NODE_ENV },
    {
      label: "Service role configured",
      value: process.env.SUPABASE_SERVICE_ROLE_KEY ? "yes" : "no",
      hint: "SUPABASE_SERVICE_ROLE_KEY presence only - the value is never read here.",
    },
  ];

  return (
    <>
      <PageHeader
        title="Auth diagnostics"
        description="Identity self-check for this deployment. Names only - never tokens or keys."
      />
      <div className="max-w-2xl overflow-hidden rounded-3xl border bg-card">
        <div className="flex items-center gap-2 border-b px-5 py-3 text-sm text-muted-foreground">
          <Stethoscope className="size-4" aria-hidden="true" />
          Every view of this page is recorded in the audit log.
        </div>
        <dl>
          {entries.map(({ label, value, hint }, i) => (
            <div key={label} className={`flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-baseline sm:gap-4 ${i > 0 ? "border-t" : ""}`}>
              <dt className="w-48 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </dt>
              <dd className="min-w-0 text-sm">
                {value}
                {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}
