"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * The single human binding-review decision form. It POSTs to
 * /api/admin/verification/bindings/[id]/review. The reviewer is derived
 * server-side; this form only carries the decision, a REQUIRED structured
 * reason code, and an optional internal note. No consequential free-text.
 */
const REASONS: Record<string, { value: string; label: string }[]> = {
  BOUND: [
    { value: "SAME_PERSON_CONFIRMED", label: "Same person confirmed" },
    { value: "SAME_PERSON_CONFIRMED_WITH_LIMITATIONS", label: "Same person - with limitations" },
  ],
  BINDING_FAILED: [
    { value: "DIFFERENT_PERSON", label: "Different person" },
    { value: "IDENTITY_EVIDENCE_MISMATCH", label: "Identity evidence mismatch" },
    { value: "LIVENESS_EVIDENCE_MISMATCH", label: "Liveness evidence mismatch" },
  ],
  REQUEST_NEW_CAPTURE: [
    { value: "INSUFFICIENT_IMAGE_QUALITY", label: "Insufficient image quality" },
    { value: "FACE_OBSCURED", label: "Face obscured" },
    { value: "MULTIPLE_PEOPLE", label: "Multiple people" },
    { value: "EVIDENCE_UNAVAILABLE", label: "Evidence unavailable" },
    { value: "PROVIDER_UNAVAILABLE", label: "Provider unavailable" },
    { value: "CONSENT_NOT_ACTIVE", label: "Consent not active" },
  ],
};

const DECISIONS: { value: string; label: string }[] = [
  { value: "BOUND", label: "Same person → Confirm binding" },
  { value: "BINDING_FAILED", label: "Different person → Fail binding" },
  { value: "REQUEST_NEW_CAPTURE", label: "Insufficient → Request new capture" },
];

export function BindingReviewForm({
  bindingId,
  disabled,
}: {
  bindingId: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [decision, setDecision] = useState<keyof typeof REASONS>("BOUND");
  const [reasonCode, setReasonCode] = useState(REASONS.BOUND[0].value);
  const [note, setNote] = useState("");

  function onDecision(next: keyof typeof REASONS) {
    setDecision(next);
    setReasonCode(REASONS[next][0].value);
  }

  function submit() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/verification/bindings/${bindingId}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, reasonCode, note: note.trim() || undefined }),
        });
        if (!res.ok) throw new Error();
        toast.success("Decision recorded.");
        router.refresh();
      } catch {
        toast.error("Could not record the decision - it may no longer be reviewable.");
      }
    });
  }

  if (disabled) {
    return <p className="text-muted-foreground text-sm">This binding is not awaiting review.</p>;
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium">Decision</label>
      <select
        className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        value={decision}
        onChange={(e) => onDecision(e.target.value as keyof typeof REASONS)}
        disabled={pending}
      >
        {DECISIONS.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label}
          </option>
        ))}
      </select>

      <label className="block text-sm font-medium">Reason</label>
      <select
        className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        value={reasonCode}
        onChange={(e) => setReasonCode(e.target.value)}
        disabled={pending}
      >
        {REASONS[decision].map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>

      <label className="block text-sm font-medium">Internal note (optional)</label>
      <textarea
        className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        rows={2}
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Internal only - never shown to the user."
        disabled={pending}
      />

      <Button className="rounded-full" disabled={pending} onClick={submit}>
        Submit decision
      </Button>
      <p className="text-muted-foreground text-xs">
        Confirming binding proves identity↔face only. The Photo Verified badge is granted only after
        the current cover also matches.
      </p>
    </div>
  );
}
