"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LEGAL_ROUTES } from "@/lib/legal/routes";

/**
 * The auth-chrome legal footer. It is the ONE legal notice for the step
 * screens (email, phone, 18+, legal, recovery) that do not render their
 * own. The /login CHOOSER (LoginEntry) renders its own complete notice
 * inside the card - Terms, Privacy AND Cookie Policy - so this global
 * footer suppresses itself there to avoid the duplicated legal text.
 */
export function AuthChromeFooter() {
  const pathname = usePathname();
  // LoginEntry owns the canonical notice on /login; don't double it.
  if (pathname === "/login") return null;

  return (
    <footer className="safe-bottom text-muted-foreground relative pb-6 text-center text-xs">
      By continuing you agree to our{" "}
      <Link
        href={LEGAL_ROUTES.terms}
        className="hover:text-foreground underline underline-offset-2"
      >
        Terms
      </Link>{" "}
      and{" "}
      <Link
        href={LEGAL_ROUTES.privacy}
        className="hover:text-foreground underline underline-offset-2"
      >
        Privacy Policy
      </Link>
      .
    </footer>
  );
}
