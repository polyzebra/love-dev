import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  CreditCard,
  Flag,
  Gavel,
  Image as ImageIcon,
  LayoutDashboard,
  Scale,
  ScrollText,
  ShieldAlert,
  Stethoscope,
  ToggleRight,
  Users,
  Compass
} from "lucide-react";
import { getCurrentAdmin } from "@/lib/auth/require-user";
import { isSuperAdmin } from "@/lib/rbac";
import { Logo } from "@/components/shared/logo";
import { Badge } from "@/components/ui/badge";
import { AccessDenied } from "./access-denied";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Tirvea Admin" } };

const NAV = [
  { href: "/admin", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/admin/users", icon: Users, label: "Users" },
  { href: "/admin/reports", icon: Flag, label: "Reports" },
  { href: "/admin/trust-safety", icon: ShieldAlert, label: "Trust & safety" },
  { href: "/admin/moderation-cases", icon: Gavel, label: "Moderation cases" },
  { href: "/admin/appeals", icon: Scale, label: "Appeals" },
  { href: "/admin/photos", icon: ImageIcon, label: "Photos" },
  { href: "/admin/verification", icon: BadgeCheck, label: "Verification" },
  { href: "/admin/payments", icon: CreditCard, label: "Payments" },
  { href: "/admin/explore", icon: Compass, label: "Explore" },
  { href: "/admin/flags", icon: ToggleRight, label: "Feature flags" },
  { href: "/admin/audit", icon: ScrollText, label: "Audit log" },
] as const;

// SUPER_ADMIN-only sections. Hiding them here is navigation, not security -
// the pages themselves gate on getCurrentAdmin("super").
const SUPER_NAV = [
  { href: "/admin/auth-diagnostics", icon: Stethoscope, label: "Diagnostics" },
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Central admin gate (single source: require-user.ts + rbac.ts).
  // Unauthenticated -> /login. Authenticated non-admin -> render the 403
  // Access Denied page INSTEAD of the admin chrome + children (per spec:
  // no redirect away). Note children are not rendered in that branch.
  const gate = await getCurrentAdmin();
  if (!gate.ok) {
    if (gate.reason === "unauthenticated") redirect("/login");
    return <AccessDenied />;
  }
  const adminUser = gate.user;
  const nav = isSuperAdmin(adminUser.role) ? [...NAV, ...SUPER_NAV] : [...NAV];

  return (
    <div className="min-h-dvh bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r bg-sidebar md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <Logo href="/admin" size="sm" />
          <Badge variant="secondary" className="rounded-full text-[10px]">
            Admin
          </Badge>
        </div>
        <nav aria-label="Admin" className="flex-1 px-3">
          <ul className="space-y-0.5">
            {nav.map(({ href, icon: Icon, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                >
                  <Icon className="size-4.5" aria-hidden="true" />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {/* Back to the member app - same session, same tab, plain Link. */}
        <div className="border-t px-3 py-2">
          <Link
            href="/discover"
            className="flex min-h-11 items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
          >
            <ArrowLeft className="size-4.5" aria-hidden="true" />
            Back to Tirvea
          </Link>
        </div>
        <div className="border-t px-5 py-4 text-xs text-muted-foreground">
          Signed in as {adminUser.email}
          <br />
          Role: {adminUser.role}
        </div>
      </aside>

      {/* Mobile top nav: horizontal scroll row (no sidebar, no overflow at
          390px). min-h-11 = 44px touch targets; desktop is untouched. */}
      <nav aria-label="Admin" className="glass safe-top sticky top-0 z-40 flex gap-1 overflow-x-auto border-b px-3 py-1.5 scrollbar-none md:hidden">
        {nav.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="flex min-h-11 shrink-0 items-center rounded-full px-3.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/20"
          >
            {label}
          </Link>
        ))}
        <span aria-hidden="true" className="my-2.5 w-px shrink-0 self-stretch bg-border/50" />
        <Link
          href="/discover"
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/20"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to Tirvea
        </Link>
      </nav>

      <main className="px-4 py-6 md:ml-60 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
