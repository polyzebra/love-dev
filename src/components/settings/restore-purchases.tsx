"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, LogOut, RotateCcw } from "lucide-react";
import { api } from "@/lib/api-client/browser";
import { signOutEverywhere } from "@/components/auth/sign-out";

/**
 * Row-styled action buttons for the settings hub "Account controls" card.
 * Both match the hub's link-row anatomy: icon bubble, label, hint.
 */

const ROW_CLASS =
  "flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/20 disabled:opacity-60";

export function RestorePurchasesRow() {
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("Re-check payment records on this account");

  async function handleRestore() {
    setBusy(true);
    const result = await api.billing.restorePurchases();
    setBusy(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    if (result.data.payments === 0 && !result.data.subscriptionTier) {
      const message = "No previous purchases found for this account.";
      setHint(message);
      toast.info(message);
      return;
    }
    // Records exist (e.g. seeded data). Report them honestly - nothing is
    // mutated, so point at where the plan is already reflected.
    const parts: string[] = [];
    if (result.data.subscriptionTier) {
      parts.push(`a ${result.data.subscriptionTier.toLowerCase()} subscription record`);
    }
    if (result.data.payments > 0) {
      parts.push(`${result.data.payments} payment record${result.data.payments === 1 ? "" : "s"}`);
    }
    const message = `Found ${parts.join(" and ")}. Your plan is shown under Subscription & billing.`;
    setHint(message);
    toast.info(message);
  }

  return (
    <button type="button" className={ROW_CLASS} onClick={handleRestore} disabled={busy}>
      <span className="bg-accent flex size-10 shrink-0 items-center justify-center rounded-2xl">
        {busy ? (
          <Loader2 className="text-accent-foreground size-5 animate-spin" aria-hidden="true" />
        ) : (
          <RotateCcw className="text-accent-foreground size-5" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">Restore purchases</span>
        <span className="text-muted-foreground block text-sm">{hint}</span>
      </span>
    </button>
  );
}

export function SignOutRow() {
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className={`${ROW_CLASS} border-t`}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void signOutEverywhere("/");
      }}
    >
      <span className="bg-accent flex size-10 shrink-0 items-center justify-center rounded-2xl">
        {busy ? (
          <Loader2 className="text-accent-foreground size-5 animate-spin" aria-hidden="true" />
        ) : (
          <LogOut className="text-accent-foreground size-5" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">Sign out</span>
        <span className="text-muted-foreground block text-sm">End your session securely</span>
      </span>
    </button>
  );
}
