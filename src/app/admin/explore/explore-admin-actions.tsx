"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { moveExploreCategory, toggleExploreCategory } from "../actions";

export function ExploreRowActions({ id, isActive }: { id: string; isActive: boolean }) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<void>) =>
    start(async () => {
      try {
        await fn();
      } catch {
        toast.error("Action failed.");
      }
    });

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        className="size-11 rounded-full md:size-9"
        aria-label="Move up"
        disabled={pending}
        onClick={() => run(() => moveExploreCategory(id, "up"))}
      >
        <ArrowUp className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 rounded-full md:size-9"
        aria-label="Move down"
        disabled={pending}
        onClick={() => run(() => moveExploreCategory(id, "down"))}
      >
        <ArrowDown className="size-4" />
      </Button>
      <Switch
        checked={isActive}
        disabled={pending}
        onCheckedChange={(v) => run(() => toggleExploreCategory(id, v))}
        aria-label="Active"
      />
    </div>
  );
}
