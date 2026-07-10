"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

export function ChatActions({ otherUserId, otherName }: { otherUserId: string; otherName: string }) {
  const router = useRouter();
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [reason, setReason] = useState<string>("FAKE_PROFILE");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitReport() {
    setBusy(true);
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportedId: otherUserId, reason, details: details || undefined }),
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
      body: JSON.stringify({ blockedId: otherUserId }),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error("Could not block right now. Try again.");
      return;
    }
    setBlockOpen(false);
    toast.success(`${otherName} is blocked.`);
    // push() to a dynamic route IS a fresh server render (the router keeps
    // no client cache for dynamic data) - a refresh() on top re-rendered
    // the whole tree a second time for nothing.
    router.push("/chat");
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Conversation options" className="rounded-full">
            <EllipsisVertical className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="rounded-2xl">
          <DropdownMenuItem onSelect={() => setReportOpen(true)}>
            <Flag className="size-4" /> Report {otherName}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setBlockOpen(true)}>
            <Ban className="size-4" /> Block {otherName}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Report dialog */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="rounded-3xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Report {otherName}</DialogTitle>
            <DialogDescription>
              Reports are confidential. {otherName} won&apos;t know you reported them.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={reason} onValueChange={setReason} className="gap-3 py-2">
            {REPORT_REASONS.map((r) => (
              <div key={r.value} className="flex items-center gap-3">
                <RadioGroupItem value={r.value} id={r.value} />
                <Label htmlFor={r.value} className="font-normal">
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
        <DialogContent className="rounded-3xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Block {otherName}?</DialogTitle>
            <DialogDescription>
              You&apos;ll disappear from each other&apos;s feeds and this conversation will close.
              This can&apos;t be undone.
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
