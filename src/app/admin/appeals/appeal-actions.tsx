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
import { Textarea } from "@/components/ui/textarea";

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Approve/reject one appeal. Approval REVERSES the violation (status
 * recomputed, photos restored, ban credentials lifted) - the dialog says
 * so explicitly before the reviewer confirms. Notes are optional but
 * encouraged; they stay staff-side (AdminLog + appeal.adminNotes).
 */
export function AppealActions({ appealId }: { appealId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [notes, setNotes] = useState("");

  function decide(kind: "approve" | "reject") {
    startTransition(async () => {
      try {
        const trimmed = notes.trim();
        const res = await fetch(`/api/admin/safety/appeals/${appealId}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision: kind,
            ...(trimmed.length >= 3 ? { adminNotes: trimmed } : {}),
          }),
        });
        if (!res.ok) {
          toast.error(await readErrorMessage(res, "Action failed - you may not have permission."));
          return;
        }
        toast.success(
          kind === "approve"
            ? "Appeal approved - the action was reversed and the user notified."
            : "Appeal rejected - the user has been notified.",
        );
        setDecision(null);
        setNotes("");
        router.refresh();
      } catch {
        toast.error("Network error. Check your connection and try again.");
      }
    });
  }

  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        className="rounded-full"
        disabled={pending}
        onClick={() => setDecision("approve")}
      >
        <Check className="size-4" /> Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="rounded-full"
        disabled={pending}
        onClick={() => setDecision("reject")}
      >
        <X className="size-4" /> Reject
      </Button>

      <Dialog
        open={decision !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDecision(null);
            setNotes("");
          }
        }}
      >
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>
              {decision === "approve" ? "Approve this appeal?" : "Reject this appeal?"}
            </DialogTitle>
            <DialogDescription>
              {decision === "approve"
                ? "Approval reverses the violation: account status is recomputed, a removed photo is restored, and ban credentials are lifted if no ban remains. The user is notified that the action was reversed."
                : "The action stays in force and the decision is final - a rejected appeal cannot be re-submitted for the same violation. The user is notified."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes for the record (staff-only, optional)"
            rows={3}
            aria-label="Admin notes"
          />
          <DialogFooter>
            <Button
              variant="ghost"
              className="rounded-full"
              onClick={() => {
                setDecision(null);
                setNotes("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant={decision === "reject" ? "destructive" : "default"}
              className="rounded-full"
              disabled={pending}
              onClick={() => decision && decide(decision)}
            >
              {decision === "approve" ? "Approve appeal" : "Reject appeal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
