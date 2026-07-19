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
import { effectiveTierOf } from "@/lib/services/entitlements";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { RestorePurchasesRow, SignOutRow } from "@/components/settings/restore-purchases";
import { LEGAL_ROUTES } from "@/lib/legal/routes";

export const metadata: Metadata = { title: "Settings" };

const GROUPS = [
  {
    title: "Your account",
    items: [
      {
        href: "/settings/account",
        icon: UserRound,
        label: "Account & verification",
        hint: "Email, phone, password",
      },
      {
        href: "/account/status",
        icon: ShieldCheck,
        label: "Account status",
        hint: "Standing, restrictions and appeals",
      },
      {
        href: "/settings/sign-in-methods",
        icon: KeyRound,
        label: "Sign-in methods",
        hint: "Google, email and phone sign-in",
      },
      {
        href: "/settings/discovery",
        icon: SlidersHorizontal,
        label: "Discovery preferences",
        hint: "Who you see, who sees you",
      },
      {
        href: "/settings/notifications",
        icon: Bell,
        label: "Notifications",
        hint: "Matches, messages, likes",
      },
      {
        href: "/settings/appearance",
        icon: SunMoon,
        label: "Appearance",
        hint: "System, light or dark",
      },
    ],
  },
  {
    title: "Membership",
    items: [
      {
        href: "/settings/subscription",
        icon: CreditCard,
        label: "Subscription & billing",
        hint: "Plan, invoices, receipts",
      },
    ],
  },
  {
    title: "Privacy & safety",
    items: [
      {
        href: "/settings/privacy",
        icon: ShieldCheck,
        label: "Privacy Centre",
        hint: "Data export, blocked users, deletion",
      },
      {
        href: "/settings/devices",
        icon: MonitorSmartphone,
        label: "Devices & sessions",
        hint: "Where you're signed in",
      },
    ],
  },
  {
    title: "Support",
    items: [
      {
        href: "/settings/support",
        icon: LifeBuoy,
        label: "Help & Support",
        hint: "FAQs and how to reach us",
      },
      {
        href: "/settings/safety",
        icon: ShieldCheck,
        label: "Safety Centre",
        hint: "Tools and guidance for safer dating",
      },
      {
        href: "/settings/community-guidelines",
        icon: BookOpenText,
        label: "Community Guidelines",
        hint: "What we expect from every member",
      },
    ],
  },
] as const;

export default async function SettingsPage() {
  const user = await requireUser();
  // Effective tier (same status policy the entitlement gates use) so the
  // badge never claims a plan the product isn't honoring.
  const tier = await effectiveTierOf(user.id);

  return (
    <>
      <PageHeader
        title="Settings"
        description={user.email}
        actions={
          <Badge variant={tier === "FREE" ? "secondary" : "default"} className="rounded-full px-3">
            {tier === "FREE" ? "Tirvea Free" : tier === "PLUS" ? "Tirvea Plus" : "Tirvea Gold"}
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
            <h2 className="text-muted-foreground mb-2 px-1 text-sm font-semibold tracking-wide uppercase">
              Staff
            </h2>
            <div className="border-border bg-card/80 shadow-card overflow-hidden rounded-3xl border">
              <Link
                href="/admin"
                className="hover:bg-muted focus-visible:bg-muted focus-visible:ring-foreground/20 flex items-center gap-4 px-5 py-4 transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
              >
                <span className="bg-accent flex size-10 shrink-0 items-center justify-center rounded-2xl">
                  <ShieldCheck className="text-accent-foreground size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Admin</span>
                  <span className="text-muted-foreground block truncate text-sm">
                    Moderation, users and platform tools
                  </span>
                </span>
                <ChevronRight
                  className="text-muted-foreground size-4 shrink-0"
                  aria-hidden="true"
                />
              </Link>
            </div>
          </section>
        )}

        {GROUPS.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h2 className="text-muted-foreground mb-2 px-1 text-sm font-semibold tracking-wide uppercase">
              {group.title}
            </h2>
            <div className="border-border bg-card/80 shadow-card overflow-hidden rounded-3xl border">
              {group.items.map(({ href, icon: Icon, label, hint }, i) => (
                <Link
                  key={href}
                  href={href}
                  className={`hover:bg-muted focus-visible:bg-muted focus-visible:ring-foreground/20 flex items-center gap-4 px-5 py-4 transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset ${
                    i > 0 ? "border-t" : ""
                  }`}
                >
                  <span className="bg-accent flex size-10 shrink-0 items-center justify-center rounded-2xl">
                    <Icon className="text-accent-foreground size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{label}</span>
                    <span className="text-muted-foreground block truncate text-sm">{hint}</span>
                  </span>
                  <ChevronRight
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden="true"
                  />
                </Link>
              ))}
            </div>
          </section>
        ))}

        <section aria-label="Account controls">
          <h2 className="text-muted-foreground mb-2 px-1 text-sm font-semibold tracking-wide uppercase">
            Account controls
          </h2>
          <div className="border-border bg-card/80 shadow-card overflow-hidden rounded-3xl border">
            <RestorePurchasesRow />
            <SignOutRow />
          </div>
          {/* Destructive action - kept apart and danger-toned, per Privacy Centre. */}
          <div className="border-destructive/30 bg-card/80 shadow-card mt-4 overflow-hidden rounded-3xl border">
            <Link
              href="/settings/privacy"
              className="hover:bg-destructive/10 focus-visible:bg-destructive/10 focus-visible:ring-foreground/20 flex items-center gap-4 px-5 py-4 transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
            >
              <span className="bg-destructive/15 flex size-10 shrink-0 items-center justify-center rounded-2xl">
                <Trash2 className="text-destructive size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-destructive block font-medium">Delete account</span>
                <span className="text-muted-foreground block truncate text-sm">
                  Permanent, with a 30-day grace period
                </span>
              </span>
              <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            </Link>
          </div>
        </section>

        <p className="text-muted-foreground pb-4 text-center text-xs">
          Tirvea v1.0 ·{" "}
          <Link href={LEGAL_ROUTES.terms} className="underline underline-offset-2">
            Terms
          </Link>{" "}
          ·{" "}
          <Link href={LEGAL_ROUTES.privacy} className="underline underline-offset-2">
            Privacy
          </Link>
        </p>
      </div>
    </>
  );
}
