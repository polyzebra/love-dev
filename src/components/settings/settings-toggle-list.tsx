"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { saveSettings } from "@/app/(app)/settings/actions";
import type { SettingsPatch } from "@/lib/services/settings";
import { SPRING } from "@/lib/motion";

/** Every boolean preference the server accepts (drops appearance, quiet
 * hours bounds, timezone - anything a Switch can't represent). */
export type SettingsToggleField = {
  [K in keyof SettingsPatch]-?: NonNullable<SettingsPatch[K]> extends boolean ? K : never;
}[keyof SettingsPatch];

export type SettingsToggleItem = {
  field: SettingsToggleField;
  label: string;
  hint?: string;
};

/**
 * A glass card of real preference toggles. Optimistic by design:
 * the switch flips instantly, the save runs in the background, and
 * only a failed save flips it back (with the server's message via
 * toast). Each row saves independently - one pending row never
 * blocks another.
 */
export function SettingsToggleList({
  items,
  initial,
}: {
  items: SettingsToggleItem[];
  initial: { [K in SettingsToggleField]?: boolean };
}) {
  const [values, setValues] = useState<Record<string, boolean>>(() => {
    const seed: Record<string, boolean> = {};
    for (const item of items) seed[item.field] = Boolean(initial[item.field]);
    return seed;
  });
  const [pending, setPending] = useState<ReadonlySet<SettingsToggleField>>(new Set());

  async function toggle(field: SettingsToggleField, next: boolean) {
    const previous = values[field];
    setValues((v) => ({ ...v, [field]: next }));
    setPending((p) => new Set(p).add(field));

    const result = await saveSettings({ [field]: next });

    setPending((p) => {
      const rest = new Set(p);
      rest.delete(field);
      return rest;
    });
    if (!result.ok) {
      setValues((v) => ({ ...v, [field]: previous }));
      toast.error(result.error);
    }
  }

  return (
    <div className="glass overflow-hidden rounded-3xl">
      {items.map(({ field, label, hint }, i) => (
        <div
          key={field}
          className={`flex min-h-14 items-center gap-4 px-5 py-4 ${
            i > 0 ? "border-t border-border" : ""
          }`}
        >
          <div className="min-w-0 flex-1 space-y-0.5">
            <Label htmlFor={`setting-${field}`} className="text-base">
              {label}
            </Label>
            {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
          </div>
          <motion.span
            className="shrink-0"
            initial={false}
            animate={values[field] ? "on" : "off"}
            variants={{ on: { scale: [0.88, 1] }, off: { scale: [0.88, 1] } }}
            transition={SPRING.snappy}
          >
            <Switch
              id={`setting-${field}`}
              aria-label={label}
              checked={values[field]}
              disabled={pending.has(field)}
              onCheckedChange={(checked) => toggle(field, checked)}
            />
          </motion.span>
        </div>
      ))}
    </div>
  );
}
