"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOutEverywhere } from "@/components/auth/sign-out";
import { toast } from "sonner";
import { FileDown, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ExportDataButton() {
  return (
    <Button variant="outline" className="rounded-full" asChild>
      <a href="/api/account/export" download>
        <FileDown className="size-4" aria-hidden="true" />
        Download my data
      </a>
    </Button>
  );
}

export function DeleteAccountButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  async function deleteAccount() {
    setBusy(true);
    const res = await fetch("/api/account/delete", { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      toast.error("Couldn't process the deletion. Contact privacy@tirvea.app.");
      return;
    }
    toast.success("Account scheduled for deletion.");
    await signOutEverywhere("/");
  }

  return (
    <>
      <Button variant="destructive" className="rounded-full" onClick={() => setOpen(true)}>
        <Trash2 className="size-4" aria-hidden="true" />
        Delete my account
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-3xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              Your profile disappears immediately and all data is permanently erased after 30 days.
              Sign in within 30 days to cancel. This includes your matches, conversations and
              purchases.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="confirm-delete">
              Type <span className="font-semibold">DELETE</span> to confirm
            </Label>
            <Input
              id="confirm-delete"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              className="h-12 rounded-2xl"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" className="rounded-2xl" onClick={() => setOpen(false)}>
              Keep my account
            </Button>
            <Button
              variant="destructive"
              className="rounded-2xl"
              disabled={confirmText !== "DELETE" || busy}
              onClick={deleteAccount}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Delete forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
