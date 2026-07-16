"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Owner control to turn OFF face comparison (withdraw biometric consent).
 * Authenticated POST to /api/verification/consent/withdraw (the server
 * derives the user from the session - no id is sent). On success the badge
 * is hidden, the provider reference deletion is requested, and the identity
 * verdict is left intact; a refresh re-renders the withdrawn state.
 *
 * When already withdrawn, shows the canonical copy instead of the button.
 */
export function FaceComparisonControl({ withdrawn }: { withdrawn: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (withdrawn) {
    return (
      <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
        Photo comparison is turned off. Your verified badge is hidden. You can enable it again by
        giving consent and completing profile verification.
      </p>
    );
  }

  async function turnOff() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/verification/consent/withdraw", { method: "POST" });
      if (!res.ok) throw new Error("failed");
      toast.success("Photo comparison turned off. Your verified badge is now hidden.");
      router.refresh();
    } catch {
      setBusy(false);
      toast.error("Couldn't turn it off right now. Please try again.");
    }
  }

  return (
    <div className="mt-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={turnOff}
        className="text-muted-foreground hover:text-foreground h-auto p-0 text-xs underline-offset-2 hover:underline"
      >
        {busy ? "Turning off…" : "Turn off photo comparison"}
      </Button>
    </div>
  );
}
