import type { Metadata } from "next";
import Link from "next/link";
import { BookOpenText, ChevronRight, LifeBuoy, Mail, ShieldCheck } from "lucide-react";
import { SettingsSubheader } from "@/components/settings/settings-subheader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Help & Support" };

const FAQ = [
  {
    q: "How do I edit my profile prompts?",
    a: "Go to your Profile and open Your prompts. You can answer up to four prompts - your answers appear on your profile and become conversation starters.",
  },
  {
    q: "How are match reasons worked out?",
    a: "The reasons on a profile card come from real overlap between your two profiles: shared interests and relationship goals, languages you both speak, how close you live and how your day-to-day habits line up. They are computed from what you both actually filled in - never invented.",
  },
  {
    q: "How do I report or block someone?",
    a: "Open the conversation, tap the menu in the top corner and choose Report or Block. Reports are confidential and reviewed by our safety team. Blocking removes you both from each other's feeds and closes the conversation. You can see who you've blocked in Settings, under Privacy Centre.",
  },
  {
    q: "How do I manage notifications?",
    a: "Go to Settings and open Notifications. You can choose exactly what reaches you - matches, messages, likes and more.",
  },
  {
    q: "How do I delete my account?",
    a: "Go to Settings, open Privacy Centre and choose Delete your account. Your profile is hidden immediately and the account is permanently erased after a 30-day grace period - sign back in before then if you change your mind. Once deletion completes, your email is free to register again.",
  },
] as const;

export default function SupportPage() {
  return (
    <>
      <SettingsSubheader
        backHref="/settings"
        backLabel="Back to settings"
        title="Help & Support"
        description="We're here to help."
      />

      <div className="space-y-6">
        <a
          href="mailto:info@tirvea.com"
          className="border-border bg-card/80 shadow-card hover:bg-muted flex items-center gap-4 rounded-3xl border px-5 py-5 transition-colors"
        >
          <span className="bg-accent flex size-11 shrink-0 items-center justify-center rounded-2xl">
            <Mail className="text-accent-foreground size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Contact us</span>
            <span className="text-muted-foreground block truncate text-sm">
              info@tirvea.com - a real person reads every message
            </span>
          </span>
          <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        </a>

        <div className="border-border bg-card/80 shadow-card overflow-hidden rounded-3xl border">
          <Link
            href="/settings/safety"
            className="hover:bg-muted flex items-center gap-4 px-5 py-4 transition-colors"
          >
            <span className="bg-accent flex size-10 shrink-0 items-center justify-center rounded-2xl">
              <ShieldCheck className="text-accent-foreground size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">Safety Centre</span>
              <span className="text-muted-foreground block truncate text-sm">
                Tools and guidance for safer dating
              </span>
            </span>
            <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          </Link>
          <Link
            href="/settings/community-guidelines"
            className="hover:bg-muted flex items-center gap-4 border-t px-5 py-4 transition-colors"
          >
            <span className="bg-accent flex size-10 shrink-0 items-center justify-center rounded-2xl">
              <BookOpenText className="text-accent-foreground size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">Community Guidelines</span>
              <span className="text-muted-foreground block truncate text-sm">
                What we expect from every member
              </span>
            </span>
            <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          </Link>
        </div>

        <Card className="rounded-3xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LifeBuoy className="text-muted-foreground size-4" aria-hidden="true" />
              Frequently asked
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {FAQ.map(({ q, a }) => (
              <div key={q} className="py-4 first:pt-0 last:pb-0">
                <h3 className="text-sm font-medium">{q}</h3>
                <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{a}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
