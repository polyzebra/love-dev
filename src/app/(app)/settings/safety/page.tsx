import type { Metadata } from "next";
import {
  Ban,
  EyeOff,
  Flag,
  MapPin,
  PhoneCall,
  Users,
  Car,
} from "lucide-react";
import { SettingsSubheader } from "@/components/settings/settings-subheader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Safety Centre" };

const MEETING_TIPS = [
  {
    icon: MapPin,
    title: "Meet somewhere public",
    body: "A cafe, a bar, a gallery - somewhere with people around, for at least the first few dates.",
  },
  {
    icon: Users,
    title: "Tell a friend",
    body: "Share who you're meeting, where and when. A quick message before and after goes a long way.",
  },
  {
    icon: Car,
    title: "Arrange your own transport",
    body: "Get yourself there and back. It keeps you free to leave whenever you want to.",
  },
] as const;

const TOOLS = [
  {
    icon: Flag,
    title: "Report",
    body: "Open any conversation, tap the menu and choose Report. Pick a reason - fake profile, harassment, scam and more - and add details if you like. Reports are confidential and reviewed by our safety team.",
  },
  {
    icon: Ban,
    title: "Block",
    body: "From the same conversation menu, choose Block. You disappear from each other's feeds instantly and the conversation closes. Your blocked list lives in Settings, under Privacy Centre.",
  },
  {
    icon: EyeOff,
    title: "Take a break",
    body: "Hide your profile from discovery any time with the visibility switch in Settings, under Discovery preferences. Turn it back on whenever you're ready.",
  },
] as const;

export default function SafetyCentrePage() {
  return (
    <>
      <SettingsSubheader
        backHref="/settings"
        backLabel="Back to settings"
        title="Safety Centre"
        description="Tools and guidance for safer dating."
      />

      <div className="space-y-6">
        <Card className="rounded-3xl">
          <CardHeader>
            <CardTitle className="text-base">Meeting someone new</CardTitle>
            <CardDescription>
              Most first dates are lovely. A little preparation keeps it that way.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {MEETING_TIPS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex items-start gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent">
                  <Icon className="size-5 text-accent-foreground" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-medium">{title}</h3>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </div>
            ))}
            <p className="rounded-2xl bg-muted px-4 py-3 text-sm leading-relaxed text-muted-foreground">
              Keep conversations on Tirvea until you trust the person, and never send money or
              share financial details - no genuine match will ever ask.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-3xl">
          <CardHeader>
            <CardTitle className="text-base">Tools built into Tirvea</CardTitle>
            <CardDescription>Everything here works today - two taps at most.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {TOOLS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex items-start gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent">
                  <Icon className="size-5 text-accent-foreground" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-medium">{title}</h3>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PhoneCall className="size-4 text-destructive" aria-hidden="true" />
              If you&apos;re in immediate danger
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              Contact local emergency services first. In Ireland and the UK call{" "}
              <span className="font-medium text-foreground">112</span> or{" "}
              <span className="font-medium text-foreground">999</span>. Elsewhere, use your local
              emergency number.
            </p>
            <p>
              For anything less urgent, our safety team is at{" "}
              <a
                href="mailto:safety@tirvea.app"
                className="font-medium text-foreground underline underline-offset-2"
              >
                safety@tirvea.app
              </a>
              . And always: trust your instincts. If something feels off, it probably is.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
