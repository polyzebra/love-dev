import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, HeartHandshake, Lightbulb, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { RESTRICTED_ACCOUNT_ROUTE } from "@/lib/auth/gate";

export const metadata: Metadata = { title: "Community resources" };
export const dynamic = "force-dynamic";

/**
 * Static, calm reference reading for the Appeals Centre. Available to
 * restricted accounts too - understanding the rules is part of the right
 * to appeal.
 */
export default async function CommunityResourcesPage() {
  await requireUser({ allow: RESTRICTED_ACCOUNT_ROUTE });

  return (
    <div className="animate-rise">
      <Link
        href="/account/status"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Account status
      </Link>
      <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">
        Community resources
      </h1>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        How Tirvea keeps the community safe, and how you can look after yourself and the people you
        meet.
      </p>

      <div className="mt-6 space-y-5">
        <section
          aria-label="Safety features"
          className="border-border bg-card/80 shadow-card rounded-3xl border p-6"
        >
          <div className="flex items-center gap-3">
            <span className="bg-accent flex size-10 shrink-0 items-center justify-center rounded-2xl">
              <ShieldCheck className="text-accent-foreground size-5" aria-hidden="true" />
            </span>
            <h2 className="font-display text-lg font-semibold tracking-tight">Safety features</h2>
          </div>
          <ul className="text-muted-foreground mt-4 space-y-3 text-sm leading-relaxed">
            <li>
              <span className="text-foreground font-medium">Photo verification.</span> Verified
              members prove they match their photos, so you know who you&apos;re talking to. Look
              for the badge - and get verified yourself from your profile.
            </li>
            <li>
              <span className="text-foreground font-medium">Block and report.</span> You can block
              anyone instantly, and every report is looked at. Reporting is always anonymous - the
              other person never finds out who raised it.
            </li>
            <li>
              <span className="text-foreground font-medium">Photo review.</span> Every profile photo
              passes a review before it appears, so what you see follows our guidelines.
            </li>
            <li>
              <span className="text-foreground font-medium">Human decisions.</span> Serious account
              actions are made or confirmed by a person, and most decisions can be appealed.
            </li>
          </ul>
        </section>

        <section
          aria-label="Safety tips"
          className="border-border bg-card/80 shadow-card rounded-3xl border p-6"
        >
          <div className="flex items-center gap-3">
            <span className="bg-accent flex size-10 shrink-0 items-center justify-center rounded-2xl">
              <Lightbulb className="text-accent-foreground size-5" aria-hidden="true" />
            </span>
            <h2 className="font-display text-lg font-semibold tracking-tight">Safety tips</h2>
          </div>
          <ul className="text-muted-foreground mt-4 space-y-3 text-sm leading-relaxed">
            <li>
              <span className="text-foreground font-medium">Keep chats on Tirvea</span> until you
              trust someone. Scammers usually push to move the conversation elsewhere quickly.
            </li>
            <li>
              <span className="text-foreground font-medium">Never send money</span> or share
              financial details - no genuine match will ever ask.
            </li>
            <li>
              <span className="text-foreground font-medium">Meet in public first.</span> Tell a
              friend where you&apos;re going, and arrange your own way there and back.
            </li>
            <li>
              <span className="text-foreground font-medium">Trust your instincts.</span> If
              something feels off, it&apos;s okay to end the conversation - and to tell us about it.
            </li>
          </ul>
        </section>

        <section
          aria-label="Community guidelines"
          className="border-border bg-card/80 shadow-card rounded-3xl border p-6"
        >
          <div className="flex items-center gap-3">
            <span className="bg-accent flex size-10 shrink-0 items-center justify-center rounded-2xl">
              <HeartHandshake className="text-accent-foreground size-5" aria-hidden="true" />
            </span>
            <h2 className="font-display text-lg font-semibold tracking-tight">
              Community guidelines
            </h2>
          </div>
          <div className="text-muted-foreground mt-4 space-y-3 text-sm leading-relaxed">
            <p>
              Tirvea is for real people looking for real connections. The guidelines come down to a
              few simple things:
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Be yourself - use recent photos of you, and only you.</li>
              <li>Be kind - harassment, hate or threats have no place here.</li>
              <li>Be honest - no spam, scams, or commercial activity.</li>
              <li>Be lawful - nothing explicit, and adults only, always.</li>
            </ul>
            <p>
              When something falls short of these guidelines we act in steps - a note first where
              possible, stronger measures only where needed - and we tell you what happened and why.
              You can read the outcome, and appeal it, from your{" "}
              <Link
                href="/account/status"
                className="hover:text-foreground underline underline-offset-2"
              >
                account status
              </Link>{" "}
              page.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
