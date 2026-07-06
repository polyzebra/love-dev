"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reviewVerification } from "../actions";

export function VerificationActions({ verificationId }: { verificationId: string }) {
  const [pending, startTransition] = useTransition();

  function review(approve: boolean) {
    startTransition(async () => {
      try {
        await reviewVerification(verificationId, approve);
        toast.success(approve ? "Verification approved." : "Verification rejected.");
      } catch {
        toast.error("Action failed - you may not have permission.");
      }
    });
  }

  return (
    <div className="flex gap-2 pt-1">
      <Button size="sm" className="rounded-full" disabled={pending} onClick={() => review(true)}>
        <Check className="size-4" /> Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="rounded-full"
        disabled={pending}
        onClick={() => review(false)}
      >
        <X className="size-4" /> Reject
      </Button>
    </div>
  );
}
