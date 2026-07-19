"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LegalRoute } from "@/lib/legal/routes";

/**
 * THE canonical legal link (single component - no page may build its own legal
 * link/button). Enforced by tests/legal-navigation-governance.test.ts.
 *
 * Responsibilities: a semantic anchor (via next/link - real href, preserves
 * browser history + scroll, never JS-only navigation), a visible focus ring,
 * keyboard support (native <a>), a 44px+ touch area, an optional "opens in a
 * new tab" affordance announced to screen readers, and best-effort analytics.
 *
 * `route` MUST come from LEGAL_ROUTES - the type is `LegalRoute`, so a hardcoded
 * arbitrary string does not typecheck.
 */
export function LegalLink({
  route,
  children,
  className,
  newTab = false,
}: {
  /** A canonical legal route (LEGAL_ROUTES.*). */
  route: LegalRoute;
  children: ReactNode;
  className?: string;
  /** Open in a new tab (announces "opens in a new tab"). Default: same tab. */
  newTab?: boolean;
}) {
  const tabProps = newTab ? { target: "_blank", rel: "noopener noreferrer" } : {};
  return (
    <Link
      href={route}
      {...tabProps}
      onClick={() => {
        // Best-effort analytics; never blocks navigation, never throws.
        try {
          void fetch("/api/analytics", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            keepalive: true,
            body: JSON.stringify({ name: "legal_doc_opened", data: { route } }),
          }).catch(() => {});
        } catch {
          /* analytics is optional */
        }
      }}
      className={cn(
        // Base: semantic anchor with a visible focus ring + keyboard support.
        // Appearance (underline / card / min touch height) is supplied by the
        // caller's className so ONE component serves inline and standalone links.
        "focus-visible:ring-ring/60 inline-flex items-center gap-1 rounded-sm focus-visible:ring-2 focus-visible:outline-none",
        className,
      )}
    >
      {children}
      {newTab && (
        <>
          <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="sr-only"> (opens in a new tab)</span>
        </>
      )}
    </Link>
  );
}
