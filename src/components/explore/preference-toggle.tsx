"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { emitInteraction } from "@/lib/interaction-events";

/** Join/leave a category - saved preferences boost your ranking inside it. */
export function ExplorePreferenceToggle({ categoryId, initialSaved }: { categoryId: string; initialSaved: boolean }) {
  const [saved, setSaved] = useState(initialSaved);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const next = !saved;
    setSaved(next);
    const res = next
      ? await fetch("/api/me/explore-preferences", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categoryId }),
        })
      : await fetch(`/api/me/explore-preferences/${categoryId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) { setSaved(!next); toast.error("Couldn't update. Try again."); return; }
    emitInteraction("step-complete");
    toast.success(next ? "Added to your Explore interests." : "Removed from your interests.");
    // No refresh(): the button state is the feedback, re-ranking the list
    // mid-view is jarring, and dynamic routes re-render server-side on the
    // next navigation regardless (no client cache).
  }

  return (
    <Button variant={saved ? "default" : "outline"} className="rounded-full" onClick={toggle} disabled={busy} aria-pressed={saved}>
      {saved ? <Check className="size-4" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
      {saved ? "In my interests" : "Add to my interests"}
    </Button>
  );
}
