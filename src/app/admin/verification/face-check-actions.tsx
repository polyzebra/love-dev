"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, BadgeCheck, Camera, Check, RotateCcw, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Staff actions for one profile-photo verification. Every action lands in
 * POST /api/admin/face-checks/[id]/action, which writes a
 * VerificationAuditEvent - there is deliberately no client-side state
 * beyond the transition.
 */
export function FaceCheckActions({
  verificationId,
  suspended,
  rejectableCheck,
}: {
  verificationId: string;
  suspended: boolean;
  /** Flagged/rejected check the staff can unpublish, when one exists. */
  rejectableCheck: { id: string; label: string } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function act(action: string, extra: Record<string, string> = {}, done = "Done.") {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/face-checks/${verificationId}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...extra }),
        });
        if (!res.ok) throw new Error();
        toast.success(done);
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
        className="rounded-full"
        disabled={pending}
        onClick={() => act("approve", {}, "Approved - badge active.")}
      >
        <Check className="size-4" /> Approve
      </Button>
      {rejectableCheck && (
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={pending}
          onClick={() =>
            act(
              "reject_photo",
              { photoCheckId: rejectableCheck.id },
              `Photo rejected (${rejectableCheck.label}).`,
            )
          }
        >
          <Camera className="size-4" /> Reject photo
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        className="rounded-full"
        disabled={pending}
        onClick={() => act("request_new_selfie", {}, "Re-challenge requested.")}
      >
        <RotateCcw className="size-4" /> New selfie
      </Button>
      {suspended ? (
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={pending}
          onClick={() => act("restore_badge", {}, "Badge restored.")}
        >
          <BadgeCheck className="size-4" /> Restore badge
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={pending}
          onClick={() => act("suspend_badge", {}, "Badge suspended.")}
        >
          <ShieldOff className="size-4" /> Suspend badge
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="rounded-full"
        disabled={pending}
        onClick={() =>
          act("escalate", { reasonCode: "fraud_review" }, "Escalated to fraud review.")
        }
      >
        <AlertTriangle className="size-4" /> Escalate
      </Button>
    </div>
  );
}
