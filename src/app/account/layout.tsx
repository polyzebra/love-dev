import Link from "next/link";
import { LEGAL_ROUTES } from "@/lib/legal/routes";
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
    <div className="noise bg-background relative flex min-h-dvh flex-col overflow-x-hidden">
      <Aurora fixed intensity="faint" />
      <header className="safe-top relative mx-auto flex w-full max-w-2xl items-center justify-between px-5 py-5">
        <Logo />
        <LogoutButton />
      </header>
      <main className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-16">
        {children}
      </main>
      <footer className="safe-bottom text-muted-foreground relative mx-auto w-full max-w-2xl px-5 pt-4 pb-8 text-center text-xs">
        <Link
          href="/account/community-resources"
          className="hover:text-foreground underline underline-offset-2"
        >
          Community resources
        </Link>{" "}
        ·{" "}
        <Link
          href={LEGAL_ROUTES.terms}
          className="hover:text-foreground underline underline-offset-2"
        >
          Terms
        </Link>{" "}
        ·{" "}
        <Link
          href={LEGAL_ROUTES.privacy}
          className="hover:text-foreground underline underline-offset-2"
        >
          Privacy
        </Link>
      </footer>
    </div>
  );
}
