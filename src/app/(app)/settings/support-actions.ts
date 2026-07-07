"use server";

import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";

export type RestorePurchasesResult =
  | {
      ok: true;
      /** Number of successful payment records on this account. */
      payments: number;
      /** Paid tier on record, or null when there is nothing to restore. */
      subscriptionTier: string | null;
    }
  | { ok: false; error: string };

/**
 * Honest "restore purchases": reads what the database actually holds for
 * the signed-in user and reports it verbatim. It never mutates anything
 * and never claims a restore succeeded - with no live purchase flow the
 * truthful answer for everyone is that no purchases were found.
 */
export async function restorePurchases(): Promise<RestorePurchasesResult> {
  const user = await requireUser();
  try {
    const [payments, subscription] = await Promise.all([
      db.payment.count({ where: { userId: user.id, status: "SUCCEEDED" } }),
      db.subscription.findUnique({
        where: { userId: user.id },
        select: { tier: true },
      }),
    ]);
    return {
      ok: true,
      payments,
      subscriptionTier:
        subscription && subscription.tier !== "FREE" ? subscription.tier : null,
    };
  } catch {
    return {
      ok: false as const,
      error: "Could not check your purchase records right now. Try again.",
    };
  }
}
