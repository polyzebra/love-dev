"use client";

import { useState, useTransition } from "react";
import { LogOut } from "lucide-react";
import { signOutEverywhere } from "@/components/auth/sign-out";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Sign-out for the account status shell - always behind a confirmation. */
export function LogoutButton() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="tap-target rounded-full text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        <LogOut className="size-4" aria-hidden="true" />
        Sign out
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>Sign out?</DialogTitle>
            <DialogDescription>
              You can sign back in any time to check your account status or the progress of an
              appeal.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              className="rounded-full"
              disabled={pending}
              onClick={() => startTransition(async () => signOutEverywhere("/"))}
            >
              Sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
