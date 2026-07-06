import type { Metadata } from "next";
import Link from "next/link";
import {
  Bell,
  ChevronRight,
  CreditCard,
  MonitorSmartphone,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { SignOutButton } from "@/components/app/sign-out-button";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const GROUPS = [
  {
    title: "Your account",
    items: [
      { href: "/settings/account", icon: UserRound, label: "Account & verification", hint: "Email, phone, password" },
      { href: "/settings/discovery", icon: SlidersHorizontal, label: "Discovery preferences", hint: "Who you see, who sees you" },
      { href: "/settings/notifications", icon: Bell, label: "Notifications", hint: "Matches, messages, likes" },
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
] as const;

export default async function SettingsPage() {
  const session = await auth();
  const subscription = await db.subscription.findUnique({
    where: { userId: session!.user.id },
    select: { tier: true },
  });
  const tier = subscription?.tier ?? "FREE";

  return (
    <>
      <PageHeader
        title="Settings"
        description={session?.user?.email ?? undefined}
        actions={
          <Badge variant={tier === "FREE" ? "secondary" : "default"} className="rounded-full px-3">
            {tier === "FREE" ? "Free plan" : tier === "PLUS" ? "Plus" : "Premium"}
          </Badge>
        }
      />

      <div className="space-y-8">
        {GROUPS.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {group.title}
            </h2>
            <div className="overflow-hidden rounded-3xl border border-white/8 bg-card/80 shadow-card">
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

        <SignOutButton />

        <p className="pb-4 text-center text-xs text-muted-foreground">
          Virelsy v1.0 · <Link href="/legal/terms" className="underline underline-offset-2">Terms</Link> ·{" "}
          <Link href="/legal/privacy" className="underline underline-offset-2">Privacy</Link>
        </p>
      </div>
    </>
  );
}
