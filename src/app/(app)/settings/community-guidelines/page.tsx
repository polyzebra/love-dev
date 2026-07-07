import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  Gavel,
  HeartHandshake,
  ShieldAlert,
  Sparkles,
  UserRound,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";

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
    body: "No scams, no asking for money, no impersonating anyone - including a fictional better-paid version of yourself. If your intentions on Virelsy aren't genuine, this isn't the place for you.",
  },
  {
    icon: ShieldAlert,
    title: "Keep it safe and adult",
    body: "Virelsy is strictly 18+. No minors, ever - in photos, in conversation, anywhere. No soliciting, no selling, no promotion. Dating only.",
  },
] as const;

export default function CommunityGuidelinesPage() {
  return (
    <>
      <Link
        href="/settings"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to settings
      </Link>

      <PageHeader
        title="Community Guidelines"
        description="A few clear rules, so everyone here can be themselves."
      />

      <div className="space-y-6">
        {GUIDELINES.map(({ icon: Icon, title, body }) => (
          <section
            key={title}
            className="rounded-3xl border border-border bg-card/80 p-6 shadow-card"
          >
            <div className="flex items-start gap-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent">
                <Icon className="size-5 text-accent-foreground" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="font-medium">{title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </div>
          </section>
        ))}

        <section className="rounded-3xl border border-destructive/30 bg-card/80 p-6 shadow-card">
          <div className="flex items-start gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-destructive/15">
              <Gavel className="size-5 text-destructive" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="font-medium">What happens when rules are broken</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Every report is reviewed by a person. Depending on what we find, that leads to a
                warning, a suspension or a permanent ban - serious violations skip straight to the
                ban. We&apos;d rather have a smaller community than an unsafe one.
              </p>
            </div>
          </div>
        </section>

        <p className="pb-4 text-center text-xs text-muted-foreground">
          Seen something that doesn&apos;t belong here? Report it from the conversation, or visit the{" "}
          <Link href="/settings/safety" className="underline underline-offset-2">
            Safety Centre
          </Link>
          .
        </p>
      </div>
    </>
  );
}
