"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";

export function FlagToggle({ flagKey, enabled }: { flagKey: string; enabled: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(enabled);
  const [pending, startTransition] = useTransition();

  return (
    <Switch
      checked={value}
      disabled={pending}
      aria-label={`Toggle ${flagKey}`}
      onCheckedChange={(next) => {
        setValue(next);
        startTransition(async () => {
          try {
            const res = await fetch(`/api/admin/flags/${encodeURIComponent(flagKey)}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ enabled: next }),
            });
            if (!res.ok) throw new Error();
            toast.success(`${flagKey} ${next ? "enabled" : "disabled"}.`);
            router.refresh();
          } catch {
            setValue(!next);
            toast.error("Only admins can change feature flags.");
          }
        });
      }}
    />
  );
}
