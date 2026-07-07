import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, ChevronRight, Mail, MessageSquareText } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { getUserSettings } from "@/lib/services/settings";
import { SettingsSubheader } from "@/components/settings/settings-subheader";
import { SettingsToggleList } from "@/components/settings/settings-toggle-list";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

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
  const user = await requireUser();
  const settings = await getUserSettings(user.id);

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
            className={`flex min-h-14 items-center gap-4 px-5 py-4 transition-colors hover:bg-white/6 focus-visible:bg-white/6 focus-visible:outline-none ${
              i > 0 ? "border-t border-white/8" : ""
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

      <section className="mt-8" aria-label="In-app">
        <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          In-app
        </h2>
        <SettingsToggleList
          initial={settings}
          items={[
            {
              field: "inAppVibrations",
              label: "Vibrations",
              hint: "Subtle haptics on key moments.",
            },
            {
              field: "inAppSounds",
              label: "Sounds",
              hint: "Soft sounds for matches and messages.",
            },
          ]}
        />
      </section>
    </>
  );
}
