"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Ban,
  BadgeCheck,
  CircleSlash,
  Clock,
  Eye,
  ImageOff,
  Info,
  ShieldAlert,
  Undo2,
} from "lucide-react";
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
import { useDialogOpener } from "../../use-dialog-opener";

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

type DecisionKey =
  | "dismiss"
  | "remove_photo"
  | "warn"
  | "require_verification"
  | "limit"
  | "suspend"
  | "ban"
  | "reverse";

type Decision = {
  key: DecisionKey;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  placeholder: string;
};

/**
 * Decision panel for one moderation case. Every decision requires a
 * written reason (it lands in AdminLog and, for enforcement, in the
 * violation's internalReason - never shown to the user). Suspend/ban are
 * destructive-styled and spell out exactly what will happen before the
 * reviewer confirms. All mutations go through the phase-1 safety routes;
 * enforcement passes moderationCaseId so the case resolves atomically.
 */
export function CaseActions({
  caseId,
  userId,
  caseStatus,
  violationType,
  photoId,
  photoRemovable,
  reversibleViolationId,
  userStatus,
}: {
  caseId: string;
  userId: string;
  caseStatus: string;
  violationType: string;
  photoId: string | null;
  photoRemovable: boolean;
  reversibleViolationId: string | null;
  userStatus: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [decision, setDecisionState] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  // Controlled dialog (no DialogTrigger): send focus back to the opener.
  const { capture, restoreFocus } = useDialogOpener();
  const setDecision = (next: Decision | null) => {
    if (next) capture();
    setDecisionState(next);
  };

  const closed = caseStatus === "REVERSED";

  async function postJson(endpoint: string, body: unknown): Promise<Response> {
    return fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function run(d: Decision, text: string) {
    startTransition(async () => {
      try {
        let res: Response;
        switch (d.key) {
          case "dismiss":
            res = await postJson(`/api/admin/safety/cases/${caseId}/review`, {
              action: "dismiss",
              decisionReason: text,
            });
            break;
          case "remove_photo": {
            res = await postJson(`/api/admin/photos/${photoId}/reject`, { reason: text });
            if (res.ok) {
              res = await postJson(`/api/admin/safety/cases/${caseId}/review`, {
                action: "take_action",
                decisionReason: text,
              });
            }
            break;
          }
          case "require_verification": {
            res = await postJson(`/api/admin/safety/users/${userId}/require-verification`, {
              reason: text,
            });
            if (res.ok) {
              res = await postJson(`/api/admin/safety/cases/${caseId}/review`, {
                action: "take_action",
                decisionReason: text,
              });
            }
            break;
          }
          case "warn":
          case "limit":
          case "suspend":
          case "ban":
            res = await postJson(`/api/admin/safety/users/${userId}/enforce`, {
              action:
                d.key === "warn"
                  ? "WARNING"
                  : d.key === "limit"
                    ? "LIMITED"
                    : d.key === "suspend"
                      ? "SUSPENDED"
                      : "BANNED",
              violationType,
              internalReason: text,
              moderationCaseId: caseId,
            });
            break;
          case "reverse":
            res = await postJson(`/api/admin/safety/violations/${reversibleViolationId}/reverse`, {
              reason: text,
            });
            break;
        }
        if (!res.ok) {
          toast.error(await readErrorMessage(res, "Action failed - you may not have permission."));
          return;
        }
        toast.success(d.confirmLabel + " - done.");
        setDecision(null);
        setReason("");
        router.refresh();
      } catch {
        toast.error("Network error. Check your connection and try again.");
      }
    });
  }

  function markUnderReview() {
    startTransition(async () => {
      try {
        const res = await postJson(`/api/admin/safety/cases/${caseId}/review`, {
          action: "under_review",
        });
        if (!res.ok) {
          toast.error(await readErrorMessage(res, "Action failed - you may not have permission."));
          return;
        }
        toast.success("Case marked under review.");
        router.refresh();
      } catch {
        toast.error("Network error. Check your connection and try again.");
      }
    });
  }

  return (
    <section className="bg-card rounded-3xl border p-5">
      <h2 className="mb-3 text-sm font-semibold">Decisions</h2>
      {closed && !reversibleViolationId && (
        <p className="text-muted-foreground text-sm">
          This case was reversed - the enforcement it carried is no longer in force and no further
          decisions are available here.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {caseStatus === "OPEN" && (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={pending}
            onClick={markUnderReview}
          >
            <Eye className="size-4" /> Mark under review
          </Button>
        )}

        {!closed && photoId && (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={pending}
            onClick={() =>
              setDecision({
                key: "dismiss",
                title: "Approve photo & dismiss case",
                description:
                  "The photo is fine and stays live. The case is dismissed with your reason on record; no action is taken against the account.",
                confirmLabel: "Approve photo",
                placeholder: "e.g. photo clearly shows the account owner - false positive",
              })
            }
          >
            <BadgeCheck className="size-4" /> Approve photo
          </Button>
        )}

        {!closed && !photoId && (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={pending}
            onClick={() =>
              setDecision({
                key: "dismiss",
                title: "Dismiss case",
                description:
                  "Closes the case with no action against the account. Your reason stays on the case record.",
                confirmLabel: "Dismiss case",
                placeholder: "e.g. reviewed - no guideline breach found",
              })
            }
          >
            <CircleSlash className="size-4" /> Dismiss case
          </Button>
        )}

        {!closed && photoId && photoRemovable && (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={pending}
            onClick={() =>
              setDecision({
                key: "remove_photo",
                title: "Remove photo",
                description:
                  "Rejects the photo (hidden everywhere immediately) and resolves the case as action taken. The owner can add a different photo.",
                confirmLabel: "Remove photo",
                placeholder: "Reason the owner and audit trail can understand",
              })
            }
          >
            <ImageOff className="size-4" /> Remove photo
          </Button>
        )}

        {!closed && (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={pending}
            onClick={() =>
              setDecision({
                key: "warn",
                title: "Warn user",
                description:
                  "Records a warning violation and notifies the user with calm, non-accusatory copy. No capability is removed.",
                confirmLabel: "Warn user",
                placeholder: "Internal reason (staff-only, never shown to the user)",
              })
            }
          >
            <Info className="size-4" /> Warn user
          </Button>
        )}

        {!closed && (userStatus === "ACTIVE" || userStatus === "LIMITED") && (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={pending}
            onClick={() =>
              setDecision({
                key: "require_verification",
                title: "Require photo verification",
                description:
                  "Moves the account to photo-review-required: it stays visible but must pass photo verification, and the case resolves as action taken. Approval lifts it back automatically.",
                confirmLabel: "Require verification",
                placeholder: "Internal reason (staff-only)",
              })
            }
          >
            <ShieldAlert className="size-4" /> Require photo verification
          </Button>
        )}

        {!closed && (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={pending}
            onClick={() =>
              setDecision({
                key: "limit",
                title: "Limit account",
                description:
                  "Pauses likes and messages for 7 days. The user keeps read access and is notified; the violation is appealable.",
                confirmLabel: "Limit account",
                placeholder: "Internal reason (staff-only, never shown to the user)",
              })
            }
          >
            <Clock className="size-4" /> Limit account
          </Button>
        )}

        {!closed && (
          <Button
            size="sm"
            variant="destructive"
            className="rounded-full"
            disabled={pending}
            onClick={() =>
              setDecision({
                key: "suspend",
                title: "Suspend this account?",
                description:
                  "The account loses all app access immediately and lands in the Appeals Centre, where it can read the decision and appeal. A person must later confirm, reverse, or escalate. This is a serious, user-visible action.",
                confirmLabel: "Suspend account",
                destructive: true,
                placeholder: "Internal reason (staff-only, required)",
              })
            }
          >
            <ShieldAlert className="size-4" /> Suspend account
          </Button>
        )}

        {!closed && (
          <Button
            size="sm"
            variant="destructive"
            className="rounded-full"
            disabled={pending}
            onClick={() =>
              setDecision({
                key: "ban",
                title: "Ban this account?",
                description:
                  "Closes the account permanently: verified phone and device go on the ban blocklist and new sign-ins are refused. The user can still read the decision and appeal. Bans are human-only decisions - be sure.",
                confirmLabel: "Ban account",
                destructive: true,
                placeholder: "Internal reason (staff-only, required)",
              })
            }
          >
            <Ban className="size-4" /> Ban account
          </Button>
        )}

        {reversibleViolationId && (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={pending}
            onClick={() =>
              setDecision({
                key: "reverse",
                title: "Reverse the decision",
                description:
                  "Reverses the enforcement action on this case: account status is recomputed, a removed photo is restored, and ban credentials are lifted if no ban remains. The case moves to reversed.",
                confirmLabel: "Reverse decision",
                placeholder: "e.g. appeal upheld informally / confirmed false positive",
              })
            }
          >
            <Undo2 className="size-4" /> Reverse decision
          </Button>
        )}
      </div>

      <Dialog
        open={decision !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDecision(null);
            setReason("");
          }
        }}
      >
        <DialogContent className="rounded-3xl" onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>{decision?.title}</DialogTitle>
            <DialogDescription>{decision?.description}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={decision?.placeholder}
            rows={3}
            aria-label="Reason"
          />
          <DialogFooter>
            <Button
              variant="ghost"
              className="rounded-full"
              onClick={() => {
                setDecision(null);
                setReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant={decision?.destructive ? "destructive" : "default"}
              className="rounded-full"
              disabled={pending || reason.trim().length < 3}
              onClick={() => decision && run(decision, reason.trim())}
            >
              {decision?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
