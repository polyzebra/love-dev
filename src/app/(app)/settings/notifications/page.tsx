import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, ChevronRight, Mail, MessageSquareText } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { SettingsSubheader } from "@/components/settings/settings-subheader";

export const metadata: Metadata = { title: "Notifications" };

const CHANNELS = [
  {
    href: "/settings/notifications/email",
    icon: Mail,
    label: "Email",
    hint: "Choose which emails help you stay connected.",
  },
  {
    href: "/settings/notifications/push",
    icon: BellRing,
    label: "Push",
    hint: "Get notified when something worth your attention happens.",
  },
  {
    href: "/settings/notifications/sms",
    icon: MessageSquareText,
    label: "SMS",
    hint: "Receive important account and safety alerts by text.",
  },
] as const;

export default async function NotificationSettingsPage() {
  await requireUser();

  return (
    <>
      <SettingsSubheader
        backHref="/settings"
        backLabel="Back to settings"
        title="Notifications"
        description="Choose what reaches you."
      />

      <nav aria-label="Notification channels" className="glass overflow-hidden rounded-3xl">
        {CHANNELS.map(({ href, icon: Icon, label, hint }, i) => (
          <Link
            key={href}
            href={href}
            className={`flex min-h-14 items-center gap-4 px-5 py-4 transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/20 ${
              i > 0 ? "border-t border-border" : ""
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
      </nav>
    </>
  );
}
