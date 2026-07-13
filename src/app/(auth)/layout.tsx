import { Suspense } from "react";
import Link from "next/link";
import { Logo } from "@/components/shared/logo";
import { Aurora } from "@/components/fx/aurora";
import { AuthStepFallback } from "@/components/auth/AuthStepFallback";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="noise relative flex min-h-dvh flex-col overflow-hidden bg-background">
      <Aurora fixed />
      <header className="safe-top relative mx-auto w-full max-w-6xl px-6 py-6 md:px-10">
        <Logo />
      </header>
      <main className="relative flex flex-1 items-center justify-center px-4 pb-16">
        <div className="glass w-full max-w-md rounded-2xl p-7 sm:p-10">
          {/* The card's loading state is ITS OWN child, not a separate
              loading.tsx segment: card and fallback travel in the same
              flight rows / adjacent HTML bytes, so no chunk boundary can
              ever paint the card empty (the "blank white bar" frame on
              slow radios). Entering the segment shows this fallback;
              in-segment step navigations keep the previous step visible
              until the next one is ready (transition semantics). */}
          <Suspense fallback={<AuthStepFallback label="Opening sign in..." />}>
            {children}
          </Suspense>
        </div>
      </main>
      <footer className="safe-bottom relative pb-6 text-center text-xs text-muted-foreground">
        By continuing you agree to our{" "}
        <Link href="/legal/terms" className="underline underline-offset-2 hover:text-foreground">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/legal/privacy" className="underline underline-offset-2 hover:text-foreground">
          Privacy Policy
        </Link>
        .
      </footer>
    </div>
  );
}
