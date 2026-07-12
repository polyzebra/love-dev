"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Trash2, X } from "lucide-react";
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
 * Row actions for the photo moderation queue. Each button calls the matching
 * admin API route (requirePermission("photos:moderate") server-side) and
 * refreshes the RSC table on success.
 */
export function PhotoActions({
  photoId,
  moderation,
}: {
  photoId: string;
  moderation: "PENDING" | "APPROVED" | "REJECTED";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reason, setReason] = useState("");
  // Controlled dialogs (no DialogTrigger): send focus back to the opener.
  const { capture, restoreFocus } = useDialogOpener();

  function run(request: () => Promise<Response>, success: string, fallback: string) {
    startTransition(async () => {
      try {
        const res = await request();
        if (!res.ok) {
          toast.error(await readErrorMessage(res, fallback));
          return;
        }
        toast.success(success);
        setRejectOpen(false);
        setDeleteOpen(false);
        setReason("");
        router.refresh();
      } catch {
        toast.error("Network error. Check your connection and try again.");
      }
    });
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {moderation !== "APPROVED" && (
        <Button
          size="sm"
          className="rounded-full"
          disabled={pending}
          onClick={() =>
            run(
              () => fetch(`/api/admin/photos/${photoId}/approve`, { method: "POST" }),
              "Photo approved.",
              "Approval failed - you may not have permission.",
            )
          }
        >
          <Check className="size-4" /> Approve
        </Button>
      )}
      {moderation !== "REJECTED" && (
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
      )}
      <Button
        size="sm"
        variant="destructive"
        className="rounded-full"
        disabled={pending}
        onClick={() => {
          capture();
          setDeleteOpen(true);
        }}
      >
        <Trash2 className="size-4" /> Delete
      </Button>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="rounded-3xl" onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>Reject photo</DialogTitle>
            <DialogDescription>
              A reason is required - it is stored in the moderation history and audit log. The
              photo stops being publicly served immediately.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Contains a phone number overlay"
            rows={3}
            aria-label="Rejection reason"
          />
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-full"
              disabled={pending || reason.trim().length < 3}
              onClick={() =>
                run(
                  () =>
                    fetch(`/api/admin/photos/${photoId}/reject`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ reason: reason.trim() }),
                    }),
                  "Photo rejected.",
                  "Rejection failed - you may not have permission.",
                )
              }
            >
              Reject photo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="rounded-3xl" onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>Delete photo permanently</DialogTitle>
            <DialogDescription>
              Removes the storage objects and the database row. This cannot be undone; the action
              is recorded in the admin audit log.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-full"
              disabled={pending}
              onClick={() =>
                run(
                  () => fetch(`/api/admin/photos/${photoId}`, { method: "DELETE" }),
                  "Photo deleted permanently.",
                  "Deletion failed - you may not have permission.",
                )
              }
            >
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
