"use client";

import { useSearchParams } from "next/navigation";

/**
 * Stripe's cancel_url is /pricing?checkout=cancelled - acknowledge the
 * return calmly and honestly (nothing was charged). Client-side so the
 * pricing page itself stays static; the page wraps this in <Suspense>.
 */
export function CheckoutCancelledNotice() {
  const params = useSearchParams();
  if (params.get("checkout") !== "cancelled") return null;

  return (
    <div
      role="status"
      className="glass-chip mx-auto mb-8 w-fit max-w-full rounded-full px-5 py-2.5 text-center text-sm text-muted-foreground"
    >
      Checkout cancelled - you haven&apos;t been charged. Upgrade whenever it feels right.
    </div>
  );
}
