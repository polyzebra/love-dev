import type { Metadata } from "next";
import Link from "next/link";
import {
  Bell,
  BookOpenText,
  ChevronRight,
  CreditCard,
  KeyRound,
  LifeBuoy,
  MonitorSmartphone,
  ShieldCheck,
  SlidersHorizontal,
  SunMoon,
  Trash2,
  UserRound,
} from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { isStaff } from "@/lib/rbac";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { RestorePurchasesRow, SignOutRow } from "@/components/settings/restore-purchases";

export const metadata: Metadata = { title: "Settings" };

const GROUPS = [
  {
    title: "Your account",
    items: [
      { href: "/settings/account", icon: UserRound, label: "Account & verification", hint: "Email, phone, password" },
      { href: "/account/status", icon: ShieldCheck, label: "Account status", hint: "Standing, restrictions and appeals" },
      { href: "/settings/sign-in-methods", icon: KeyRound, label: "Sign-in methods", hint: "Google, email and phone sign-in" },
      { href: "/settings/discovery", icon: SlidersHorizontal, label: "Discovery preferences", hint: "Who you see, who sees you" },
      { href: "/settings/notifications", icon: Bell, label: "Notifications", hint: "Matches, messages, likes" },
      { href: "/settings/appearance", icon: SunMoon, label: "Appearance", hint: "System, light or dark" },
    ],
  },
  {
    title: "Membership",
    items: [
      { href: "/settings/subscription", icon: CreditCard, label: "Subscription & billing", hint: "Plan, invoices, receipts" },
    ],
  },
  {
    title: "Privacy & safety",
    items: [
      { href: "/settings/privacy", icon: ShieldCheck, label: "Privacy Centre", hint: "Data export, blocked users, deletion" },
      { href: "/settings/devices", icon: MonitorSmartphone, label: "Devices & sessions", hint: "Where you're signed in" },
    ],
  },
  {
    title: "Support",
    items: [
      { href: "/settings/support", icon: LifeBuoy, label: "Help & Support", hint: "FAQs and how to reach us" },
      { href: "/settings/safety", icon: ShieldCheck, label: "Safety Centre", hint: "Tools and guidance for safer dating" },
      { href: "/settings/community-guidelines", icon: BookOpenText, label: "Community Guidelines", hint: "What we expect from every member" },
    ],
  },
] as const;

export default async function SettingsPage() {
  const user = await requireUser();
  const subscription = await db.subscription.findUnique({
    where: { userId: user.id },
    select: { tier: true },
  });
  const tier = subscription?.tier ?? "FREE";

  return (
    <>
      <PageHeader
        title="Settings"
        description={user.email}
        actions={
          <Badge variant={tier === "FREE" ? "secondary" : "default"} className="rounded-full px-3">
            {tier === "FREE" ? "Free plan" : tier === "PLUS" ? "Plus" : "Gold"}
          </Badge>
        }
      />

      <div className="space-y-8">
        {/* Staff-only nav row (MODERATOR/ADMIN/SUPER_ADMIN). This is a
            server-side render conditional for NAVIGATION only - it is not
            the security boundary; /admin enforces its own role gate
            (getCurrentAdmin) on every request. */}
        {isStaff(user.role) && (
          <section aria-label="Staff">
            <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Staff
            </h2>
            <div className="overflow-hidden rounded-3xl border border-border bg-card/80 shadow-card">
              <Link
                href="/admin"
                className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent">
                  <ShieldCheck className="size-5 text-accent-foreground" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Admin</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    Moderation, users and platform tools
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </div>
          </section>
        )}

        {GROUPS.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {group.title}
            </h2>
            <div className="overflow-hidden rounded-3xl border border-border bg-card/80 shadow-card">
              {group.items.map(({ href, icon: Icon, label, hint }, i) => (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted ${
                    i > 0 ? "border-t" : ""
                  }`}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent">
                    <Icon className="size-5 text-accent-foreground" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{label}</span>
                    <span className="block truncate text-sm text-muted-foreground">{hint}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </section>
        ))}

        <section aria-label="Account controls">
          <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Account controls
          </h2>
          <div className="overflow-hidden rounded-3xl border border-border bg-card/80 shadow-card">
            <RestorePurchasesRow />
            <SignOutRow />
          </div>
          {/* Destructive action - kept apart and danger-toned, per Privacy Centre. */}
          <div className="mt-4 overflow-hidden rounded-3xl border border-destructive/30 bg-card/80 shadow-card">
            <Link
              href="/settings/privacy"
              className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-destructive/10"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-destructive/15">
                <Trash2 className="size-5 text-destructive" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-destructive">Delete account</span>
                <span className="block truncate text-sm text-muted-foreground">
                  Permanent, with a 30-day grace period
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </div>
        </section>

        <p className="pb-4 text-center text-xs text-muted-foreground">
          Tirvea v1.0 · <Link href="/legal/terms" className="underline underline-offset-2">Terms</Link> ·{" "}
          <Link href="/legal/privacy" className="underline underline-offset-2">Privacy</Link>
        </p>
      </div>
    </>
  );
}
