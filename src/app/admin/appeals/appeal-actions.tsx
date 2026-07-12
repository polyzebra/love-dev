"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Eye, MessageCircleQuestion, X } from "lucide-react";
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
import { useDialogOpener } from "../use-dialog-opener";

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Staff actions on one appeal:
 *  - Start review (SUBMITTED/PENDING_REVIEW -> UNDER_REVIEW)
 *  - Ask for info (-> NEEDS_INFO; the question is USER-VISIBLE and lands
 *    on the appeal timeline - the dialog says so in red)
 *  - Approve/reject: approval REVERSES the violation (status recomputed,
 *    photos restored, ban credentials lifted) - the dialog says so
 *    explicitly before the reviewer confirms. Notes are optional but
 *    encouraged; they stay staff-side (AdminLog + appeal.adminNotes).
 */
export function AppealActions({
  appealId,
  status,
}: {
  appealId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [decision, setDecisionState] = useState<"approve" | "reject" | null>(null);
  const [notes, setNotes] = useState("");
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState("");
  // Controlled dialogs (no DialogTrigger): send focus back to the opener.
  const { capture, restoreFocus } = useDialogOpener();
  const setDecision = (next: "approve" | "reject" | null) => {
    if (next) capture();
    setDecisionState(next);
  };

  const submitted = status === "SUBMITTED" || status === "PENDING_REVIEW";
  // Any pre-decision state may be decided; NEEDS_INFO cannot be re-asked.
  const canAsk = submitted || status === "UNDER_REVIEW";

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

  function startReview() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/safety/appeals/${appealId}/under-review`, {
          method: "POST",
        });
        if (!res.ok) {
          toast.error(await readErrorMessage(res, "Action failed - you may not have permission."));
          return;
        }
        toast.success("Appeal marked under review.");
        router.refresh();
      } catch {
        toast.error("Network error. Check your connection and try again.");
      }
    });
  }

  function askForInfo() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/safety/appeals/${appealId}/needs-info`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: question.trim() }),
        });
        if (!res.ok) {
          toast.error(await readErrorMessage(res, "Action failed - you may not have permission."));
          return;
        }
        toast.success("Question sent - the user has 14 days to reply.");
        setAskOpen(false);
        setQuestion("");
        router.refresh();
      } catch {
        toast.error("Network error. Check your connection and try again.");
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {submitted && (
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={pending}
          onClick={startReview}
        >
          <Eye className="size-4" /> Start review
        </Button>
      )}
      {canAsk && (
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={pending}
          onClick={() => {
            capture();
            setAskOpen(true);
          }}
        >
          <MessageCircleQuestion className="size-4" /> Ask for info
        </Button>
      )}
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
        open={askOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAskOpen(false);
            setQuestion("");
          }
        }}
      >
        <DialogContent className="rounded-3xl" onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>Ask the user for more information</DialogTitle>
            <DialogDescription>
              The appeal moves to needs-info and the user gets 14 days to send one reply before it
              closes automatically.{" "}
              <span className="font-semibold text-destructive">
                This question is shown to the user on their appeal timeline
              </span>{" "}
              - keep staff-only commentary in the decision notes instead.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Could you tell us more about where this photo was taken?"
            rows={3}
            aria-label="Question shown to the user"
          />
          <DialogFooter>
            <Button
              variant="ghost"
              className="rounded-full"
              onClick={() => {
                setAskOpen(false);
                setQuestion("");
              }}
            >
              Cancel
            </Button>
            <Button
              className="rounded-full"
              disabled={pending || question.trim().length < 3}
              onClick={askForInfo}
            >
              Send question
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={decision !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDecision(null);
            setNotes("");
          }
        }}
      >
        <DialogContent className="rounded-3xl" onCloseAutoFocus={restoreFocus}>
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
