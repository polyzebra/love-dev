"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, EllipsisVertical, EyeOff, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Status = "ACTIVE" | "SUSPENDED" | "SHADOW_BANNED";

/** Same confirm-dialog register as the user-detail trust actions. */
const CONFIRMS: Record<
  Status,
  {
    title: string;
    description: string;
    confirmLabel: string;
    success: string;
    destructive: boolean;
  }
> = {
  ACTIVE: {
    title: "Reinstate this account?",
    description:
      "Sets the account back to active. The user regains full access immediately; the change is recorded in the audit log.",
    confirmLabel: "Reinstate account",
    success: "User reinstated.",
    destructive: false,
  },
  SHADOW_BANNED: {
    title: "Shadow ban this account?",
    description:
      "The account keeps working but stops being shown to other members. The user is not notified. This is a serious, silent restriction - the change is recorded in the audit log.",
    confirmLabel: "Shadow ban account",
    success: "User shadow banned.",
    destructive: true,
  },
  SUSPENDED: {
    title: "Suspend this account?",
    description:
      "The account loses app access immediately. For safety enforcement with a recorded reason and an appeal path, prefer Suspend (safety) on the user page. The change is recorded in the audit log.",
    confirmLabel: "Suspend account",
    success: "User suspended.",
    destructive: true,
  },
};

export function UserRowActions({ userId, status }: { userId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<Status | null>(null);
  // The dialog opens from a dropdown ITEM that unmounts with the menu, so
  // Radix has nothing to restore focus to - send it back to the trigger.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = (e: Event) => {
    e.preventDefault();
    triggerRef.current?.focus();
  };

  function update(next: Status) {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/users/${userId}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next }),
        });
        if (!res.ok) throw new Error();
        toast.success(CONFIRMS[next].success);
        setConfirm(null);
        router.refresh();
      } catch {
        toast.error("Action failed - you may not have permission.");
      }
    });
  }

  const dialog = confirm ? CONFIRMS[confirm] : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon"
            aria-label="User actions"
            className="size-11 rounded-full md:size-9"
            disabled={pending}
          >
            <EllipsisVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="rounded-2xl">
          {status !== "ACTIVE" && (
            <DropdownMenuItem onSelect={() => setConfirm("ACTIVE")}>
              <RotateCcw className="size-4" /> Reinstate
            </DropdownMenuItem>
          )}
          {status !== "SHADOW_BANNED" && (
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("SHADOW_BANNED")}>
              <EyeOff className="size-4" /> Shadow ban
            </DropdownMenuItem>
          )}
          {status !== "SUSPENDED" && (
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("SUSPENDED")}>
              <Ban className="size-4" /> Suspend
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="rounded-3xl" onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>{dialog?.title}</DialogTitle>
            <DialogDescription>{dialog?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant={dialog?.destructive ? "destructive" : "default"}
              className="rounded-full"
              disabled={pending}
              onClick={() => confirm && update(confirm)}
            >
              {dialog?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
