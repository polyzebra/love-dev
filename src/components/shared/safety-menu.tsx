"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Ban, EllipsisVertical, Flag, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

const REPORT_REASONS = [
  { value: "FAKE_PROFILE", label: "Fake profile or catfishing" },
  { value: "HARASSMENT", label: "Harassment or abusive messages" },
  { value: "INAPPROPRIATE_CONTENT", label: "Inappropriate content" },
  { value: "SCAM", label: "Scam or asking for money" },
  { value: "SPAM", label: "Spam or promotion" },
  { value: "OTHER", label: "Something else" },
] as const;

/**
 * Report/block for PROFILE surfaces (viewer, peek) - available but
 * deliberately secondary: one quiet overflow trigger, destructive intent
 * only inside the confirm dialogs. Same /api/reports + /api/blocks
 * contracts as the conversation's ChatActions (which additionally owns
 * chat navigation, so it keeps its own copy).
 */
export function SafetyMenu({
  userId,
  name,
  triggerClassName,
  onBlocked,
}: {
  userId: string;
  name: string;
  /** Style the trigger for its surface (e.g. on-photo glass). */
  triggerClassName?: string;
  /** Called after a successful block - the surface decides where to go. */
  onBlocked?: () => void;
}) {
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [reason, setReason] = useState<string>("FAKE_PROFILE");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  // The dialogs open from a dropdown ITEM that unmounts with the menu, so
  // Radix has nothing to restore focus to - send it back to the trigger.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = (e: Event) => {
    e.preventDefault();
    triggerRef.current?.focus();
  };

  async function submitReport() {
    setBusy(true);
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportedId: userId, reason, details: details || undefined }),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error("Could not submit the report. Try again.");
      return;
    }
    setReportOpen(false);
    toast.success("Report received. Our safety team will review it.");
  }

  async function submitBlock() {
    setBusy(true);
    const res = await fetch("/api/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blockedId: userId }),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error("Could not block right now. Try again.");
      return;
    }
    setBlockOpen(false);
    toast.success(`${name} is blocked.`);
    onBlocked?.();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            variant="secondary"
            size="icon"
            aria-label={`More options for ${name}`}
            className={triggerClassName}
          >
            <EllipsisVertical className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="rounded-2xl">
          <DropdownMenuItem onSelect={() => setReportOpen(true)}>
            <Flag className="size-4" /> Report {name}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setBlockOpen(true)}>
            <Ban className="size-4" /> Block {name}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Report dialog */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="rounded-3xl sm:max-w-md" onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>Report {name}</DialogTitle>
            <DialogDescription>
              Reports are confidential. {name} won&apos;t know you reported them.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={reason} onValueChange={setReason} className="gap-3 py-2">
            {REPORT_REASONS.map((r) => (
              <div key={r.value} className="flex items-center gap-3">
                <RadioGroupItem value={r.value} id={`safety-${r.value}`} />
                <Label htmlFor={`safety-${r.value}`} className="font-normal">
                  {r.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
          <Textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Anything else we should know? (optional)"
            maxLength={1000}
            className="rounded-2xl"
          />
          <DialogFooter>
            <Button variant="ghost" className="rounded-2xl" onClick={() => setReportOpen(false)}>
              Cancel
            </Button>
            <Button className="rounded-2xl" onClick={submitReport} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Submit report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Block confirmation */}
      <Dialog open={blockOpen} onOpenChange={setBlockOpen}>
        <DialogContent className="rounded-3xl sm:max-w-sm" onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>Block {name}?</DialogTitle>
            <DialogDescription>
              You&apos;ll disappear from each other&apos;s feeds. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" className="rounded-2xl" onClick={() => setBlockOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" className="rounded-2xl" onClick={submitBlock} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Block
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
