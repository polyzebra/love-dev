"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleSlash, Hand, UserRoundCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatAgo } from "@/lib/utils";
import {
  ACCOUNT_STATUS_BADGE,
  CASE_STATUS_BADGE,
  SEVERITY_BADGE,
  pretty,
} from "../safety-badges";

/**
 * Interactive moderation-case queue: row selection + bulk bar (assign to
 * me / dismiss with one reason), per-row Claim, and the SLA due/overdue
 * badge. Bulk actions loop the existing single-case routes client-side so
 * every item keeps its own permission check and audit entry; the result
 * toast reports per-item success/failure honestly.
 */

export type CaseRow = {
  id: string;
  caseType: string;
  status: string;
  severity: string;
  priority: string;
  source: string;
  summary: string;
  createdAt: Date;
  slaDueAt: Date | null;
  resolvedAt: Date | null;
  isOverdue: boolean;
  assignedToId: string | null;
  assigneeEmail: string | null;
  violationCount: number;
  user: { id: string; email: string; status: string; safetyRiskScore: number };
};

const OPEN_STATUSES = ["OPEN", "UNDER_REVIEW", "APPEALED"];

/** "3h" / "2d 4h" - coarse on purpose, queues don't need seconds. */
function formatSpan(ms: number): string {
  const totalHours = Math.max(0, Math.round(ms / 3_600_000));
  if (totalHours < 1) return "under 1h";
  if (totalHours < 48) return `${totalHours}h`;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

function SlaBadge({ row, nowMs }: { row: CaseRow; nowMs: number }) {
  const open = OPEN_STATUSES.includes(row.status) && !row.resolvedAt;
  if (!open || !row.slaDueAt) return null;
  const delta = row.slaDueAt.getTime() - nowMs;
  if (row.isOverdue || delta < 0) {
    return (
      <Badge variant="destructive" className="rounded-full">
        OVERDUE {formatSpan(-delta)}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="rounded-full tabular-nums">
      due in {formatSpan(delta)}
    </Badge>
  );
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function CaseList({
  rows,
  meId,
  now,
}: {
  rows: CaseRow[];
  meId: string;
  /** Server-computed render time - keeps SLA math pure on the client. */
  now: Date;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dismissOpen, setDismissOpen] = useState(false);
  const [dismissReason, setDismissReason] = useState("");
  const [pending, startTransition] = useTransition();

  // Only rows a bulk action can touch are selectable (open-ish cases).
  const selectableIds = useMemo(
    () => new Set(rows.filter((r) => OPEN_STATUSES.includes(r.status)).map((r) => r.id)),
    [rows],
  );
  const selectedIds = [...selected].filter((id) => selectableIds.has(id));

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function runBulk(
    label: string,
    request: (id: string) => Promise<Response>,
  ): Promise<void> {
    let done = 0;
    const failures: string[] = [];
    // Sequential on purpose: honest per-item results, no thundering herd.
    for (const id of selectedIds) {
      try {
        const res = await request(id);
        if (res.ok) done += 1;
        else failures.push(await readErrorMessage(res, `Case ${id.slice(0, 8)}… failed.`));
      } catch {
        failures.push("Network error.");
      }
    }
    if (failures.length === 0) {
      toast.success(`${label}: ${done} case${done === 1 ? "" : "s"} updated.`);
    } else {
      toast.error(
        `${label}: ${done} updated, ${failures.length} failed - ${failures[0]}`,
      );
    }
    setSelected(new Set());
    router.refresh();
  }

  function bulkAssignToMe() {
    startTransition(async () => {
      await runBulk("Assign to me", (id) =>
        fetch(`/api/admin/safety/cases/${id}/claim`, { method: "POST" }),
      );
    });
  }

  function bulkDismiss() {
    const reason = dismissReason.trim();
    startTransition(async () => {
      await runBulk("Dismiss", (id) =>
        fetch(`/api/admin/safety/cases/${id}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "dismiss", decisionReason: reason }),
        }),
      );
      setDismissOpen(false);
      setDismissReason("");
    });
  }

  function claim(id: string) {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/safety/cases/${id}/claim`, { method: "POST" });
        if (!res.ok) {
          toast.error(await readErrorMessage(res, "Claim failed - you may not have permission."));
          return;
        }
        toast.success("Case claimed - it's yours now.");
        router.refresh();
      } catch {
        toast.error("Network error. Check your connection and try again.");
      }
    });
  }

  return (
    <div className="space-y-3">
      {/* Bulk actions bar - appears with a selection. */}
      {selectedIds.length > 0 && (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-full border bg-card/95 px-4 py-2 shadow-float backdrop-blur"
        >
          <span className="text-sm font-medium tabular-nums">
            {selectedIds.length} selected
          </span>
          <Button
            size="sm"
            className="rounded-full"
            disabled={pending}
            onClick={bulkAssignToMe}
          >
            <UserRoundCheck className="size-4" /> Assign to me
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={pending}
            onClick={() => setDismissOpen(true)}
          >
            <CircleSlash className="size-4" /> Dismiss…
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto rounded-full"
            disabled={pending}
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      {rows.map((row) => {
        const selectable = selectableIds.has(row.id);
        const claimable =
          selectable && (row.assignedToId === null || row.assignedToId === meId);
        const mine = row.assignedToId === meId;
        return (
          <div
            key={row.id}
            className="flex gap-3 rounded-3xl border bg-card p-5 transition-shadow hover:shadow-float"
          >
            <Checkbox
              checked={selected.has(row.id)}
              onCheckedChange={(checked) => toggle(row.id, checked === true)}
              disabled={!selectable}
              aria-label={`Select ${pretty(row.caseType)} case for ${row.user.email}`}
              className="mt-1"
            />
            <div className="min-w-0 flex-1">
              <Link href={`/admin/moderation-cases/${row.id}`} className="block">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={SEVERITY_BADGE[row.severity] ?? "outline"} className="rounded-full">
                    {pretty(row.severity)}
                  </Badge>
                  {row.priority !== row.severity && (
                    <Badge variant={SEVERITY_BADGE[row.priority] ?? "outline"} className="rounded-full">
                      priority {pretty(row.priority)}
                    </Badge>
                  )}
                  <Badge variant={CASE_STATUS_BADGE[row.status] ?? "outline"} className="rounded-full">
                    {pretty(row.status)}
                  </Badge>
                  <SlaBadge row={row} nowMs={now.getTime()} />
                  <span className="text-sm font-medium">{pretty(row.caseType)}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatAgo(row.createdAt)} · {pretty(row.source)}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{row.summary}</p>
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="truncate font-medium text-foreground">{row.user.email}</span>
                  <Badge
                    variant={ACCOUNT_STATUS_BADGE[row.user.status] ?? "outline"}
                    className="rounded-full"
                  >
                    {pretty(row.user.status)}
                  </Badge>
                  <span>risk {row.user.safetyRiskScore}</span>
                  {row.violationCount > 0 && (
                    <span>
                      {row.violationCount} linked action{row.violationCount === 1 ? "" : "s"}
                    </span>
                  )}
                </p>
              </Link>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {row.assignedToId ? (
                  <Badge variant={mine ? "secondary" : "outline"} className="rounded-full">
                    {mine ? "assigned to you" : `assigned · ${row.assigneeEmail ?? row.assignedToId}`}
                  </Badge>
                ) : (
                  selectable && (
                    <Badge variant="outline" className="rounded-full">
                      unassigned
                    </Badge>
                  )
                )}
                {claimable && !mine && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    disabled={pending}
                    onClick={() => claim(row.id)}
                  >
                    <Hand className="size-4" /> Claim
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      <Dialog
        open={dismissOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDismissOpen(false);
            setDismissReason("");
          }
        }}
      >
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>
              Dismiss {selectedIds.length} case{selectedIds.length === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription>
              Each case closes with no action against the account. One reason is recorded on
              every case; each dismissal is audited individually.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={dismissReason}
            onChange={(e) => setDismissReason(e.target.value)}
            placeholder="e.g. reviewed batch - no guideline breach found"
            rows={3}
            aria-label="Dismissal reason applied to every selected case"
          />
          <DialogFooter>
            <Button
              variant="ghost"
              className="rounded-full"
              onClick={() => {
                setDismissOpen(false);
                setDismissReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              className="rounded-full"
              disabled={pending || dismissReason.trim().length < 3}
              onClick={bulkDismiss}
            >
              Dismiss cases
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
