"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Hand, UserRoundX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Case assignment control. Claim (safety:read) is self-service and never
 * steals a held case; picking a specific person or unassigning goes
 * through /assign (safety:manage) - the server enforces both, this UI
 * only hides what the current role cannot do.
 */

export type StaffOption = { id: string; email: string; role: string };

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function AssignControl({
  caseId,
  assignedToId,
  assigneeEmail,
  meId,
  staff,
  canManage,
  caseOpen,
}: {
  caseId: string;
  assignedToId: string | null;
  assigneeEmail: string | null;
  meId: string;
  staff: StaffOption[];
  /** Current viewer holds safety:manage (may assign others / unassign). */
  canManage: boolean;
  caseOpen: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<string>("");

  function post(body: { assigneeId: string | null } | null) {
    startTransition(async () => {
      try {
        const res = body
          ? await fetch(`/api/admin/safety/cases/${caseId}/assign`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            })
          : await fetch(`/api/admin/safety/cases/${caseId}/claim`, { method: "POST" });
        if (!res.ok) {
          toast.error(await readErrorMessage(res, "Action failed - you may not have permission."));
          return;
        }
        toast.success(
          !body
            ? "Case claimed - it's yours now."
            : body.assigneeId
              ? "Case assigned."
              : "Assignment cleared.",
        );
        setPicked("");
        router.refresh();
      } catch {
        toast.error("Network error. Check your connection and try again.");
      }
    });
  }

  if (!caseOpen) {
    return (
      <p className="text-muted-foreground text-sm">
        {assignedToId
          ? `Handled by ${assigneeEmail ?? assignedToId}.`
          : "This case closed without an assignee."}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        {assignedToId ? (
          assignedToId === meId ? (
            <span className="font-medium">Assigned to you</span>
          ) : (
            <>
              Assigned to <span className="font-medium">{assigneeEmail ?? assignedToId}</span>
            </>
          )
        ) : (
          <span className="text-muted-foreground">Nobody is on this case yet.</span>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {!assignedToId && (
          <Button size="sm" className="rounded-full" disabled={pending} onClick={() => post(null)}>
            <Hand className="size-4" /> Claim
          </Button>
        )}
        {canManage && (
          <>
            <Select value={picked} onValueChange={setPicked} disabled={pending}>
              <SelectTrigger
                className="h-9 w-56 rounded-full"
                aria-label="Assign to a staff member"
              >
                <SelectValue placeholder="Assign to…" />
              </SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.email} · {s.role.toLowerCase().replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              disabled={pending || !picked || picked === assignedToId}
              onClick={() => post({ assigneeId: picked })}
            >
              Assign
            </Button>
            {assignedToId && (
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                disabled={pending}
                onClick={() => post({ assigneeId: null })}
              >
                <UserRoundX className="size-4" /> Unassign
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
