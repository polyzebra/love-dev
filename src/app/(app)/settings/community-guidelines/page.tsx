import type { Metadata } from "next";
import Link from "next/link";
import { Gavel, HeartHandshake, ShieldAlert, Sparkles, UserRound } from "lucide-react";
import { SettingsSubheader } from "@/components/settings/settings-subheader";

export const metadata: Metadata = { title: "Community Guidelines" };

const GUIDELINES = [
  {
    icon: UserRound,
    title: "Be yourself",
    body: "Recent photos of you, your real name, your actual age. The person across the table should recognise the person from the profile - that's the whole point.",
  },
  {
    icon: HeartHandshake,
    title: "Respect, always",
    body: "No harassment, no hate, no cruelty dressed up as honesty. Someone not replying, or saying no, is an answer - accept it gracefully. Treat every member the way you'd want your best friend treated.",
  },
  {
    icon: Sparkles,
    title: "Be honest",
    body: "No scams, no asking for money, no impersonating anyone - including a fictional better-paid version of yourself. If your intentions on Tirvea aren't genuine, this isn't the place for you.",
  },
  {
    icon: ShieldAlert,
    title: "Keep it safe and adult",
    body: "Tirvea is strictly 18+. No minors, ever - in photos, in conversation, anywhere. No soliciting, no selling, no promotion. Dating only.",
  },
] as const;

export default function CommunityGuidelinesPage() {
  return (
    <>
      <SettingsSubheader
        backHref="/settings"
        backLabel="Back to settings"
        title="Community Guidelines"
        description="A few clear rules, so everyone here can be themselves."
      />

      <div className="space-y-6">
        {GUIDELINES.map(({ icon: Icon, title, body }) => (
          <section
            key={title}
            className="border-border bg-card/80 shadow-card rounded-3xl border p-6"
          >
            <div className="flex items-start gap-4">
              <span className="bg-accent flex size-11 shrink-0 items-center justify-center rounded-2xl">
                <Icon className="text-accent-foreground size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="font-medium">{title}</h2>
                <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{body}</p>
              </div>
            </div>
          </section>
        ))}

        <section className="border-destructive/30 bg-card/80 shadow-card rounded-3xl border p-6">
          <div className="flex items-start gap-4">
            <span className="bg-destructive/15 flex size-11 shrink-0 items-center justify-center rounded-2xl">
              <Gavel className="text-destructive size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="font-medium">What happens when rules are broken</h2>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                Every report is reviewed by a person. Depending on what we find, that leads to a
                warning, a suspension or a permanent ban - serious violations skip straight to the
                ban. We&apos;d rather have a smaller community than an unsafe one.
              </p>
            </div>
          </div>
        </section>

        <p className="text-muted-foreground pb-4 text-center text-xs">
          Seen something that doesn&apos;t belong here? Report it from the conversation, or visit
          the{" "}
          <Link href="/settings/safety" className="underline underline-offset-2">
            Safety Centre
          </Link>
          .
        </p>
      </div>
    </>
  );
}
