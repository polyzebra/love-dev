"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { SupportStatus, SupportPriority } from "@/generated/prisma/enums";

const STATUSES: SupportStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_USER", "RESOLVED", "CLOSED"];
const PRIORITIES: SupportPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

const selectClass =
  "border-input bg-background focus-visible:ring-ring/60 h-10 rounded-xl border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none";

export function SupportActions({
  id,
  status,
  priority,
  spam,
  assigned,
}: {
  id: string;
  status: SupportStatus;
  priority: SupportPriority;
  spam: boolean;
  assigned: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function patch(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/support/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      toast.success(okMsg);
      router.refresh();
    } catch {
      toast.error("Couldn't apply the change.");
    } finally {
      setBusy(false);
    }
  }

  async function submitNote() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/support/${id}/note`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: note.trim() }),
      });
      if (!res.ok) throw new Error();
      setNote("");
      toast.success("Note added.");
      router.refresh();
    } catch {
      toast.error("Couldn't add the note.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-border space-y-5 rounded-2xl border p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="support-status">Status</Label>
          <select
            id="support-status"
            className={selectClass + " w-full"}
            defaultValue={status}
            disabled={busy}
            onChange={(e) => patch({ status: e.currentTarget.value }, "Status updated.")}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="support-priority">Priority</Label>
          <select
            id="support-priority"
            className={selectClass + " w-full"}
            defaultValue={priority}
            disabled={busy}
            onChange={(e) => patch({ priority: e.currentTarget.value }, "Priority updated.")}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p.toLowerCase()}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          disabled={busy}
          onClick={() => patch({ assign: assigned ? "none" : "me" }, assigned ? "Unassigned." : "Assigned to you.")}
        >
          {assigned ? "Unassign" : "Assign to me"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          disabled={busy}
          onClick={() => patch({ spam: !spam }, spam ? "Marked not spam." : "Marked as spam.")}
        >
          {spam ? "Not spam" : "Mark spam"}
        </Button>
        {status !== "CLOSED" ? (
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            disabled={busy}
            onClick={() => patch({ status: "CLOSED" }, "Closed.")}
          >
            Close
          </Button>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="support-note">Internal note</Label>
        <Textarea
          id="support-note"
          rows={3}
          value={note}
          maxLength={4000}
          placeholder="Staff-only note (never shown to the user)…"
          onChange={(e) => setNote(e.currentTarget.value)}
          disabled={busy}
        />
        <Button size="sm" className="rounded-full" disabled={busy || !note.trim()} onClick={submitNote}>
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
          Add note
        </Button>
      </div>
    </div>
  );
}
