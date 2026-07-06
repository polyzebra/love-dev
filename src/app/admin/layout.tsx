import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  CreditCard,
  Flag,
  LayoutDashboard,
  ScrollText,
  ToggleRight,
  Users,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/rbac";
import { Logo } from "@/components/shared/logo";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Amora Admin" } };

const NAV = [
  { href: "/admin", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/admin/users", icon: Users, label: "Users" },
  { href: "/admin/reports", icon: Flag, label: "Reports" },
  { href: "/admin/verification", icon: BadgeCheck, label: "Verification" },
  { href: "/admin/payments", icon: CreditCard, label: "Payments" },
  { href: "/admin/flags", icon: ToggleRight, label: "Feature flags" },
  { href: "/admin/audit", icon: ScrollText, label: "Audit log" },
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!isStaff(session.user.role)) redirect("/discover");

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
            {NAV.map(({ href, icon: Icon, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  <Icon className="size-4.5" aria-hidden="true" />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t px-5 py-4 text-xs text-muted-foreground">
          Signed in as {session.user.email}
          <br />
          Role: {session.user.role}
        </div>
      </aside>

      {/* Mobile top nav */}
      <nav aria-label="Admin" className="glass safe-top sticky top-0 z-40 flex gap-1 overflow-x-auto border-b px-3 py-2 scrollbar-none md:hidden">
        {NAV.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {label}
          </Link>
        ))}
      </nav>

      <main className="px-4 py-6 md:ml-60 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
