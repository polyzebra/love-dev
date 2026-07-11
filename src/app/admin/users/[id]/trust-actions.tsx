"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, MailOpen, PhoneOff, RefreshCw, RotateCcw, ShieldQuestion, Undo2 } from "lucide-react";
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

type ConfirmAction = {
  title: string;
  description: string;
  endpoint: string;
  success: string;
  confirmLabel: string;
  destructive?: boolean;
};

/**
 * Trust panel actions. Each button calls the matching admin API route
 * (requirePermission server-side, AdminLog + AuthVerificationEvent
 * recorded there) and refreshes the RSC page on success. Destructive
 * actions confirm first; a ban requires a written reason.
 */
export function TrustActions({
  userId,
  banned,
  hasPhone,
  phoneVerified,
  phoneSyncStatus,
  emailBlocked,
  onboardingDone,
  canReleaseDeletedPhone,
}: {
  userId: string;
  banned: boolean;
  hasPhone: boolean;
  phoneVerified: boolean;
  /** auth.users.phone mirror state - null when no verified phone. */
  phoneSyncStatus: string | null;
  emailBlocked: boolean;
  onboardingDone: boolean;
  /** True only for SUPER_ADMIN viewers when the holder is conclusively
   *  not alive (DELETED, or its auth.users row is gone) - server-decided. */
  canReleaseDeletedPhone: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [banOpen, setBanOpen] = useState(false);
  const [banReason, setBanReason] = useState("");
  const [releaseDeletedOpen, setReleaseDeletedOpen] = useState(false);
  const [releaseDeletedReason, setReleaseDeletedReason] = useState("");
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);

  function post(endpoint: string, success: string, body?: unknown) {
    startTransition(async () => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          ...(body !== undefined
            ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
            : {}),
        });
        if (!res.ok) {
          toast.error(await readErrorMessage(res, "Action failed - you may not have permission."));
          return;
        }
        toast.success(success);
        setBanOpen(false);
        setBanReason("");
        setReleaseDeletedOpen(false);
        setReleaseDeletedReason("");
        setConfirm(null);
        router.refresh();
      } catch {
        toast.error("Network error. Check your connection and try again.");
      }
    });
  }

  const base = `/api/admin/users/${userId}`;

  return (
    <div className="flex flex-wrap gap-2">
      {banned ? (
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={pending}
          onClick={() =>
            setConfirm({
              title: "Restore access",
              description:
                "Clears the ban and sets the account back to active. The user can sign in again immediately.",
              endpoint: `${base}/unban`,
              success: "Access restored.",
              confirmLabel: "Restore access",
            })
          }
        >
          <Undo2 className="size-4" /> Unban
        </Button>
      ) : (
        <Button
          size="sm"
          variant="destructive"
          className="rounded-full"
          disabled={pending}
          onClick={() => setBanOpen(true)}
        >
          <Ban className="size-4" /> Ban
        </Button>
      )}

      {hasPhone && (
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={pending}
          onClick={() =>
            setConfirm({
              title: "Release phone number",
              description:
                "Removes the phone number from this account so a different account can verify with it. The user will be asked for a phone number again if the phone step is enabled.",
              endpoint: `${base}/release-phone`,
              success: "Phone number released.",
              confirmLabel: "Release phone",
              destructive: true,
            })
          }
        >
          <PhoneOff className="size-4" /> Release phone
        </Button>
      )}

      {canReleaseDeletedPhone && (
        <Button
          size="sm"
          variant="destructive"
          className="rounded-full"
          disabled={pending}
          onClick={() => setReleaseDeletedOpen(true)}
        >
          <PhoneOff className="size-4" /> Release phone (deleted account)
        </Button>
      )}

      {emailBlocked && (
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={pending}
          onClick={() =>
            setConfirm({
              title: "Release email",
              description:
                "Removes this email from the identity blocklist so it can authenticate again. This does not lift a ban on the account itself.",
              endpoint: `${base}/release-email`,
              success: "Email released from the blocklist.",
              confirmLabel: "Release email",
            })
          }
        >
          <MailOpen className="size-4" /> Release email
        </Button>
      )}

      {phoneVerified && (
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={pending}
          onClick={() =>
            setConfirm({
              title: "Re-sync phone to auth",
              description:
                phoneSyncStatus === "SYNCED"
                  ? "The auth identity already mirrors this number - re-syncing rewrites it anyway. No SMS is sent."
                  : "Writes the verified number into the auth identity (auth.users.phone). No SMS is sent; the app-side verification is untouched.",
              endpoint: `${base}/resync-phone`,
              success: "Phone re-synced to the auth identity.",
              confirmLabel: "Re-sync phone",
            })
          }
        >
          <RefreshCw className="size-4" /> Re-sync phone
        </Button>
      )}

      {phoneVerified && (
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={pending}
          onClick={() =>
            setConfirm({
              title: "Require phone re-verification",
              description:
                "The user keeps their number but must verify it again on their next visit before using the app.",
              endpoint: `${base}/require-phone-reverification`,
              success: "Phone re-verification required.",
              confirmLabel: "Require re-verification",
            })
          }
        >
          <ShieldQuestion className="size-4" /> Require phone re-verify
        </Button>
      )}

      {onboardingDone && (
        <Button
          size="sm"
          variant="ghost"
          className="rounded-full"
          disabled={pending}
          onClick={() =>
            setConfirm({
              title: "Reset onboarding",
              description:
                "Sends the user back through onboarding on their next visit. Existing profile data is kept.",
              endpoint: `${base}/reset-onboarding`,
              success: "Onboarding reset.",
              confirmLabel: "Reset onboarding",
            })
          }
        >
          <RotateCcw className="size-4" /> Reset onboarding
        </Button>
      )}

      <Dialog open={banOpen} onOpenChange={setBanOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>Ban this account</DialogTitle>
            <DialogDescription>
              A reason is required - it is shown to the user on the restricted-account page and
              stored in the audit log. The account is signed out and blocked from signing in.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
            placeholder="e.g. Spam - repeated unsolicited commercial messages"
            rows={3}
            aria-label="Ban reason"
          />
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setBanOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-full"
              disabled={pending || banReason.trim().length < 3}
              onClick={() => post(`${base}/ban`, "Account banned.", { reason: banReason.trim() })}
            >
              Ban account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={releaseDeletedOpen} onOpenChange={setReleaseDeletedOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>Release phone from deleted account</DialogTitle>
            <DialogDescription>
              This account is not alive (deleted, or its auth identity is gone) but still holds a
              verified phone number, blocking anyone else from verifying with it. Releasing frees
              the number; nothing is attached anywhere - the next owner must verify it with a fresh
              SMS code. A written reason is required and stored in the audit log.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={releaseDeletedReason}
            onChange={(e) => setReleaseDeletedReason(e.target.value)}
            placeholder="e.g. orphaned by account deletion - owner asked to reuse the number"
            rows={3}
            aria-label="Release reason"
          />
          <DialogFooter>
            <Button
              variant="ghost"
              className="rounded-full"
              onClick={() => setReleaseDeletedOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-full"
              disabled={pending || releaseDeletedReason.trim().length < 3}
              onClick={() =>
                post(`${base}/release-deleted-phone`, "Phone number released.", {
                  reason: releaseDeletedReason.trim(),
                })
              }
            >
              Release number
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
            <DialogDescription>{confirm?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant={confirm?.destructive ? "destructive" : "default"}
              className="rounded-full"
              disabled={pending}
              onClick={() => confirm && post(confirm.endpoint, confirm.success)}
            >
              {confirm?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
