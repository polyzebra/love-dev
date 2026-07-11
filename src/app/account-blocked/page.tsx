import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Account restricted" };
export const dynamic = "force-dynamic";

const POSSIBLE_REASONS = [
  "Breaking the community guidelines",
  "Spam or commercial activity",
  "Signals of a fake account",
  "Impersonating someone else",
  "Protecting the safety of other members",
];

/**
 * Calm landing spot for banned/suspended accounts. No auth guard on
 * purpose - a terminated session can still read why it was terminated.
 * We make a BEST-EFFORT attempt to identify the account (the Supabase
 * cookie may or may not still be valid) purely to show the reason on
 * file and prefill the support email. Honest by design: there is no
 * ticket system behind this page - support@tirvea.app is a real inbox
 * and every review is done by a person.
 */
async function banContext(): Promise<{ id: string; banReason: string | null } | null> {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const row = await db.user.findUnique({
      where: { id: user.id },
      select: { id: true, banReason: true, bannedAt: true, status: true },
    });
    if (!row || (!row.bannedAt && row.status !== "SUSPENDED" && row.status !== "BANNED")) {
      return null;
    }
    return { id: row.id, banReason: row.banReason };
  } catch {
    return null;
  }
}

function supportMailto(accountId: string | null): string {
  const subject = "Account review request";
  const body = [
    "Hello Tirvea team,",
    "",
    "I'd like to ask for a review of my account restriction.",
    "",
    `Account ID: ${accountId ?? "(please add the email address you signed up with)"}`,
    "",
    "Why I believe this should be reviewed:",
    "",
  ].join("\n");
  return `mailto:support@tirvea.app?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default async function AccountBlockedPage() {
  const ctx = await banContext();

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="safe-top mx-auto w-full max-w-2xl px-5 py-5">
        <Logo />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-5 pb-24 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Account restricted</h1>

        {ctx?.banReason ? (
          <p className="mt-4 leading-relaxed text-muted-foreground">
            Reason on file: <span className="font-medium text-foreground">{ctx.banReason}</span>
          </p>
        ) : (
          <p className="mt-4 leading-relaxed text-muted-foreground">
            Access to this account has been paused following a review.
          </p>
        )}

        <div className="mt-6 w-full rounded-3xl border bg-card p-5 text-left">
          <p className="text-sm font-medium">Accounts can be restricted for:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {POSSIBLE_REASONS.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>

        <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
          If you believe this is a mistake, email us and we will take a careful look. Decisions
          are made by people, not automatically - and a reply can take a little time.
        </p>

        <Button asChild className="mt-6 rounded-full px-6">
          <a href={supportMailto(ctx?.id ?? null)}>Contact support</a>
        </Button>

        <Link
          href="/"
          className="mt-5 text-sm font-medium text-primary-soft underline-offset-2 hover:underline"
        >
          Back to the homepage
        </Link>
      </main>
    </div>
  );
}
