"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export function ExploreRowActions({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const post = async (path: string, body: unknown) => {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
  };
  const run = (fn: () => Promise<void>) =>
    start(async () => {
      try {
        await fn();
        router.refresh();
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
        onClick={() =>
          run(() => post(`/api/admin/explore/categories/${id}/move`, { direction: "up" }))
        }
      >
        <ArrowUp className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 rounded-full md:size-9"
        aria-label="Move down"
        disabled={pending}
        onClick={() =>
          run(() => post(`/api/admin/explore/categories/${id}/move`, { direction: "down" }))
        }
      >
        <ArrowDown className="size-4" />
      </Button>
      <Switch
        checked={isActive}
        disabled={pending}
        onCheckedChange={(v) =>
          run(() => post(`/api/admin/explore/categories/${id}/toggle`, { isActive: v }))
        }
        aria-label="Active"
      />
    </div>
  );
}
