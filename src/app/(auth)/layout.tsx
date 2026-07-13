import Link from "next/link";
import { Logo } from "@/components/shared/logo";
import { Aurora } from "@/components/fx/aurora";

/**
 * Auth chrome ONLY: aurora, wordmark, legal footer, centring. The glass
 * card deliberately does NOT live here - the router can commit this
 * layout while the child segment is still streaming (real-iPhone debug
 * logs showed the child slot as null with no fallback), and a card
 * drawn around an unresolved slot paints as an empty white bar. Cards
 * are owned by the content: AuthCard wraps every step shell, the login
 * entry, the segment loading state and each route-level fallback.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-debug="auth-layout"
      className="noise bg-background relative flex min-h-dvh flex-col overflow-hidden"
    >
      <Aurora fixed />
      <header className="safe-top relative mx-auto w-full max-w-6xl px-6 py-6 md:px-10">
        <Logo />
      </header>
      <main className="relative flex flex-1 items-center justify-center px-4 pb-16">
        {children}
      </main>
      <footer className="safe-bottom text-muted-foreground relative pb-6 text-center text-xs">
        By continuing you agree to our{" "}
        <Link href="/legal/terms" className="hover:text-foreground underline underline-offset-2">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/legal/privacy" className="hover:text-foreground underline underline-offset-2">
          Privacy Policy
        </Link>
        .
      </footer>
    </div>
  );
}
