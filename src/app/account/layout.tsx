import Link from "next/link";
import { Logo } from "@/components/shared/logo";
import { Aurora } from "@/components/fx/aurora";
import { LogoutButton } from "./logout-button";

/**
 * Minimal shell for the Appeals Centre (/account/status and friends).
 * Deliberately NOT the (app) group: restricted (suspended/banned) accounts
 * land here and must not see navigation into swipe/chat/likes. Just the
 * logo, a sign-out with confirmation, the page, and a quiet footer.
 * Every page under this segment guards itself with
 * requireUser({ allow: RESTRICTED_ACCOUNT_ROUTE }).
 */
export default function AccountStatusLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="noise relative flex min-h-dvh flex-col overflow-x-hidden bg-background">
      <Aurora fixed intensity="faint" />
      <header className="safe-top relative mx-auto flex w-full max-w-2xl items-center justify-between px-5 py-5">
        <Logo />
        <LogoutButton />
      </header>
      <main className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-16">
        {children}
      </main>
      <footer className="safe-bottom relative mx-auto w-full max-w-2xl px-5 pb-8 pt-4 text-center text-xs text-muted-foreground">
        <Link
          href="/account/community-resources"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Community resources
        </Link>{" "}
        ·{" "}
        <Link href="/legal/terms" className="underline underline-offset-2 hover:text-foreground">
          Terms
        </Link>{" "}
        ·{" "}
        <Link href="/legal/privacy" className="underline underline-offset-2 hover:text-foreground">
          Privacy
        </Link>
      </footer>
    </div>
  );
}
