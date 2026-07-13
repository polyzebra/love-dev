"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { Check, Moon, MonitorSmartphone, Sun } from "lucide-react";
import { toast } from "sonner";
import { saveSettings } from "@/app/(app)/settings/actions";
import { SPRING } from "@/lib/motion";
import { applyAppearance, type AppearanceMode } from "@/lib/theme";

const OPTIONS: {
  value: AppearanceMode;
  label: string;
  hint: string;
  icon: typeof Sun;
}[] = [
  {
    value: "SYSTEM",
    label: "Use system setting",
    hint: "Match your device's appearance preference.",
    icon: MonitorSmartphone,
  },
  { value: "LIGHT", label: "Light", hint: "Always light.", icon: Sun },
  { value: "DARK", label: "Dark", hint: "Always dark.", icon: Moon },
];

/**
 * Appearance preference as selectable glass cards. The theme applies
 * to the whole app instantly (250ms token cross-fade, no reload),
 * persists via saveSettings, and reverts - visually too - with a
 * toast if the save fails.
 */
export function AppearancePicker({ initial }: { initial: AppearanceMode }) {
  const [value, setValue] = useState<AppearanceMode>(initial);
  const [pending, setPending] = useState(false);

  async function select(next: AppearanceMode) {
    if (next === value) return;
    const previous = value;
    setValue(next);
    applyAppearance(next);
    setPending(true);

    const result = await saveSettings({ appearance: next });

    setPending(false);
    if (!result.ok) {
      setValue(previous);
      applyAppearance(previous);
      toast.error(result.error);
    }
  }

  return (
    <div>
      <RadioGroupPrimitive.Root
        value={value}
        onValueChange={(next) => select(next as AppearanceMode)}
        aria-label="Appearance"
        className="grid gap-3"
      >
        {OPTIONS.map(({ value: option, label, hint, icon: Icon }) => (
          <RadioGroupPrimitive.Item
            key={option}
            value={option}
            disabled={pending}
            aria-label={label}
            className="glass hover:bg-foreground/5 focus-visible:ring-foreground/20 data-[state=checked]:bg-accent flex min-h-14 w-full items-center gap-4 rounded-3xl px-5 py-4 text-left transition-colors outline-none focus-visible:ring-2 data-[disabled]:opacity-70"
          >
            <span className="bg-accent flex size-10 shrink-0 items-center justify-center rounded-2xl">
              <Icon className="text-accent-foreground size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{label}</span>
              <span className="text-muted-foreground block truncate text-sm">{hint}</span>
            </span>
            <span className="flex size-6 shrink-0 items-center justify-center">
              <RadioGroupPrimitive.Indicator asChild>
                <motion.span
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={SPRING.snappy}
                  className="bg-primary flex size-6 items-center justify-center rounded-full"
                >
                  <Check className="text-primary-foreground size-3.5" aria-hidden="true" />
                </motion.span>
              </RadioGroupPrimitive.Indicator>
            </span>
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>
    </div>
  );
}
