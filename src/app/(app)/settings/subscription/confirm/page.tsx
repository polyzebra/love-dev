import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/require-user";
import { CheckoutConfirm } from "@/components/billing/checkout-confirm";

export const metadata: Metadata = { title: "Confirming your membership" };

/**
 * Stripe success_url lands here (?session_id={CHECKOUT_SESSION_ID}).
 * Server shell only: the gate runs (requireUser via this page + the (app)
 * layout), the session id is read from the URL, and the small client
 * poller does the honest work - it asks /api/billing/checkout-status,
 * which verifies ownership and syncs from Stripe server-side. Arriving
 * here grants NOTHING; a missing session_id renders the invalid state.
 */
export default async function CheckoutConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string | string[] }>;
}) {
  await requireUser();
  const params = await searchParams;
  const sessionId =
    typeof params.session_id === "string" && params.session_id.length > 0
      ? params.session_id
      : null;

  return (
    <div className="flex min-h-[60dvh] items-center justify-center py-10">
      <CheckoutConfirm sessionId={sessionId} />
    </div>
  );
}
