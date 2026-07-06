"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { toggleFeatureFlag } from "../actions";

export function FlagToggle({ flagKey, enabled }: { flagKey: string; enabled: boolean }) {
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
            await toggleFeatureFlag(flagKey, next);
            toast.success(`${flagKey} ${next ? "enabled" : "disabled"}.`);
          } catch {
            setValue(!next);
            toast.error("Only admins can change feature flags.");
          }
        });
      }}
    />
  );
}
