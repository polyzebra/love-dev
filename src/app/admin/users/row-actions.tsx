"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Ban, EllipsisVertical, EyeOff, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setUserStatus } from "../actions";

export function UserRowActions({ userId, status }: { userId: string; status: string }) {
  const [pending, startTransition] = useTransition();

  function update(next: "ACTIVE" | "SUSPENDED" | "SHADOW_BANNED") {
    startTransition(async () => {
      try {
        await setUserStatus(userId, next);
        toast.success(`User ${next === "ACTIVE" ? "reinstated" : next.toLowerCase().replace("_", " ")}.`);
      } catch {
        toast.error("Action failed — you may not have permission.");
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="User actions" className="rounded-full" disabled={pending}>
          <EllipsisVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rounded-2xl">
        {status !== "ACTIVE" && (
          <DropdownMenuItem onSelect={() => update("ACTIVE")}>
            <RotateCcw className="size-4" /> Reinstate
          </DropdownMenuItem>
        )}
        {status !== "SHADOW_BANNED" && (
          <DropdownMenuItem onSelect={() => update("SHADOW_BANNED")}>
            <EyeOff className="size-4" /> Shadow ban
          </DropdownMenuItem>
        )}
        {status !== "SUSPENDED" && (
          <DropdownMenuItem variant="destructive" onSelect={() => update("SUSPENDED")}>
            <Ban className="size-4" /> Suspend
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
