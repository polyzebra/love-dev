"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Ban, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveReport, setUserStatus } from "../actions";

export function ReportActions({
  reportId,
  reportedUserId,
}: {
  reportId: string;
  reportedUserId: string;
}) {
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<void>, message: string) {
    startTransition(async () => {
      try {
        await fn();
        toast.success(message);
      } catch {
        toast.error("Action failed — you may not have permission.");
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
        onClick={() =>
          run(async () => {
            await setUserStatus(reportedUserId, "SUSPENDED");
            await resolveReport(reportId, "ACTION_TAKEN", "User suspended");
          }, "User suspended and report closed.")
        }
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
            () => resolveReport(reportId, "ACTION_TAKEN", "Warning issued"),
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
        onClick={() => run(() => resolveReport(reportId, "DISMISSED"), "Report dismissed.")}
      >
        <X className="size-4" /> Dismiss
      </Button>
    </div>
  );
}
