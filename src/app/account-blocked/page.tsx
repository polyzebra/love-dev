import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/shared/logo";

export const metadata: Metadata = { title: "Account unavailable" };

/**
 * Calm landing spot for banned/suspended accounts. No auth guard on
 * purpose - a terminated session can still read why it was terminated.
 */
export default function AccountBlockedPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="safe-top mx-auto w-full max-w-2xl px-5 py-5">
        <Logo />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-5 pb-24 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          This account can&apos;t be used right now
        </h1>
        <p className="mt-4 leading-relaxed text-muted-foreground">
          Access to this account has been paused. If you believe this is a mistake, our support
          team will take a careful look - just reach out at{" "}
          <a href="mailto:support@tirvea.com" className="font-medium text-primary-soft underline-offset-2 hover:underline">
            support@tirvea.com
          </a>
          .
        </p>
        <Link
          href="/"
          className="mt-8 text-sm font-medium text-primary-soft underline-offset-2 hover:underline"
        >
          Back to the homepage
        </Link>
      </main>
    </div>
  );
}
