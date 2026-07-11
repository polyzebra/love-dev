"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Clock, Info, RefreshCw, ShieldAlert } from "lucide-react";
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

type EnforceKey = "WARNING" | "LIMITED" | "SUSPENDED" | "BANNED" | "REQUIRE_VERIFICATION";

type PendingAction = {
  key: EnforceKey;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
};

/**
 * Safety enforcement panel on the admin user page. Human-only decisions:
 * every action requires a written internal reason; suspend/ban confirm with
 * destructive styling. All go through the phase-1 safety routes (violation
 * written, user notified with calm copy, AdminLog recorded); recompute
 * refreshes the composite trust profile.
 */
export function SafetyActions({ userId, userStatus }: { userId: string; userStatus: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState("");

  function run(a: PendingAction, text: string) {
    startTransition(async () => {
      try {
        const res =
          a.key === "REQUIRE_VERIFICATION"
            ? await fetch(`/api/admin/safety/users/${userId}/require-verification`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason: text }),
              })
            : await fetch(`/api/admin/safety/users/${userId}/enforce`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: a.key,
                  violationType: "OTHER",
                  internalReason: text,
                }),
              });
        if (!res.ok) {
          toast.error(await readErrorMessage(res, "Action failed - you may not have permission."));
          return;
        }
        toast.success(`${a.confirmLabel} - done.`);
        setAction(null);
        setReason("");
        router.refresh();
      } catch {
        toast.error("Network error. Check your connection and try again.");
      }
    });
  }

  function recompute() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/safety/users/${userId}/recompute`, { method: "POST" });
        if (!res.ok) {
          toast.error(await readErrorMessage(res, "Action failed - you may not have permission."));
          return;
        }
        toast.success("Trust profile recomputed.");
        router.refresh();
      } catch {
        toast.error("Network error. Check your connection and try again.");
      }
    });
  }

  const restricted = userStatus === "SUSPENDED" || userStatus === "BANNED";

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        className="rounded-full"
        disabled={pending}
        onClick={recompute}
      >
        <RefreshCw className="size-4" /> Recompute risk
      </Button>

      <Button
        size="sm"
        variant="outline"
        className="rounded-full"
        disabled={pending}
        onClick={() =>
          setAction({
            key: "WARNING",
            title: "Warn user",
            description:
              "Records a warning violation and notifies the user with calm, non-accusatory copy. No capability is removed.",
            confirmLabel: "Warn user",
          })
        }
      >
        <Info className="size-4" /> Warn
      </Button>

      {(userStatus === "ACTIVE" || userStatus === "LIMITED") && (
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={pending}
          onClick={() =>
            setAction({
              key: "REQUIRE_VERIFICATION",
              title: "Require photo verification",
              description:
                "Moves the account to photo-review-required: it stays visible but must pass photo verification. Approval lifts it back to active automatically.",
              confirmLabel: "Require verification",
            })
          }
        >
          <ShieldAlert className="size-4" /> Require photo verification
        </Button>
      )}

      {!restricted && (
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={pending}
          onClick={() =>
            setAction({
              key: "LIMITED",
              title: "Limit account",
              description:
                "Pauses likes and messages for 7 days. The user keeps read access and is notified; the violation is appealable.",
              confirmLabel: "Limit account",
            })
          }
        >
          <Clock className="size-4" /> Limit
        </Button>
      )}

      {userStatus !== "SUSPENDED" && userStatus !== "BANNED" && (
        <Button
          size="sm"
          variant="destructive"
          className="rounded-full"
          disabled={pending}
          onClick={() =>
            setAction({
              key: "SUSPENDED",
              title: "Suspend this account?",
              description:
                "The account loses all app access immediately and lands in the Appeals Centre, where it can read the decision and appeal. This is a serious, user-visible action.",
              confirmLabel: "Suspend account",
              destructive: true,
            })
          }
        >
          <ShieldAlert className="size-4" /> Suspend (safety)
        </Button>
      )}

      {userStatus !== "BANNED" && (
        <Button
          size="sm"
          variant="destructive"
          className="rounded-full"
          disabled={pending}
          onClick={() =>
            setAction({
              key: "BANNED",
              title: "Ban this account?",
              description:
                "Closes the account permanently: verified phone and device go on the ban blocklist and new sign-ins are refused. The user can still read the decision and appeal. Bans are human-only decisions - be sure.",
              confirmLabel: "Ban account",
              destructive: true,
            })
          }
        >
          <Ban className="size-4" /> Ban (safety)
        </Button>
      )}

      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAction(null);
            setReason("");
          }
        }}
      >
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>{action?.title}</DialogTitle>
            <DialogDescription>{action?.description}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Internal reason (staff-only, never shown to the user)"
            rows={3}
            aria-label="Internal reason"
          />
          <DialogFooter>
            <Button
              variant="ghost"
              className="rounded-full"
              onClick={() => {
                setAction(null);
                setReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant={action?.destructive ? "destructive" : "default"}
              className="rounded-full"
              disabled={pending || reason.trim().length < 3}
              onClick={() => action && run(action, reason.trim())}
            >
              {action?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
