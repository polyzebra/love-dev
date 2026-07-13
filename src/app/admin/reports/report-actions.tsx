"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Check, X } from "lucide-react";
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

/** POST helper for the admin mutation routes; throws on any non-2xx. */
async function postJson(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error();
}

export function ReportActions({
  reportId,
  reportedUserId,
}: {
  reportId: string;
  reportedUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [suspendOpen, setSuspendOpen] = useState(false);
  // Controlled dialog (no DialogTrigger): send focus back to the opener.
  const { capture, restoreFocus } = useDialogOpener();

  function run(fn: () => Promise<void>, message: string) {
    startTransition(async () => {
      try {
        await fn();
        toast.success(message);
        setSuspendOpen(false);
        router.refresh();
      } catch {
        toast.error("Action failed - you may not have permission.");
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2 pt-1">
      <Button
        size="sm"
        variant="destructive"
        className="rounded-full"
        disabled={pending}
        onClick={() => {
          capture();
          setSuspendOpen(true);
        }}
      >
        <Ban className="size-4" /> Suspend user
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="rounded-full"
        disabled={pending}
        onClick={() =>
          run(
            () =>
              postJson(`/api/admin/reports/${reportId}/resolve`, {
                outcome: "ACTION_TAKEN",
                resolution: "Warning issued",
              }),
            "Marked as actioned.",
          )
        }
      >
        <Check className="size-4" /> Action taken
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="rounded-full"
        disabled={pending}
        onClick={() =>
          run(
            () => postJson(`/api/admin/reports/${reportId}/resolve`, { outcome: "DISMISSED" }),
            "Report dismissed.",
          )
        }
      >
        <X className="size-4" /> Dismiss
      </Button>

      <Dialog open={suspendOpen} onOpenChange={setSuspendOpen}>
        <DialogContent className="rounded-3xl" onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>Suspend this account?</DialogTitle>
            <DialogDescription>
              The reported account loses app access immediately and the report closes as action
              taken. Both changes are recorded in the audit log. This is a serious, user-visible
              action.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setSuspendOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-full"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  await postJson(`/api/admin/users/${reportedUserId}/status`, {
                    status: "SUSPENDED",
                  });
                  await postJson(`/api/admin/reports/${reportId}/resolve`, {
                    outcome: "ACTION_TAKEN",
                    resolution: "User suspended",
                  });
                }, "User suspended and report closed.")
              }
            >
              Suspend account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
