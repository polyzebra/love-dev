"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDialogOpener } from "../use-dialog-opener";

export function VerificationActions({ verificationId }: { verificationId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  // Controlled dialog (no DialogTrigger): send focus back to the opener.
  const { capture, restoreFocus } = useDialogOpener();

  function review(approve: boolean) {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/verifications/${verificationId}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approve }),
        });
        if (!res.ok) throw new Error();
        toast.success(approve ? "Verification approved." : "Verification rejected.");
        setRejectOpen(false);
        router.refresh();
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
        onClick={() => {
          capture();
          setRejectOpen(true);
        }}
      >
        <X className="size-4" /> Reject
      </Button>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="rounded-3xl" onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>Reject this verification?</DialogTitle>
            <DialogDescription>
              The request is closed as rejected and the user is notified. A photo verification also
              clears the verified badge. The user can start a new verification at any time; the
              decision is recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-full"
              disabled={pending}
              onClick={() => review(false)}
            >
              Reject verification
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
