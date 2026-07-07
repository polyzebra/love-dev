"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { Check, Moon, MonitorSmartphone, Sun } from "lucide-react";
import { toast } from "sonner";
import { saveSettings } from "@/app/(app)/settings/actions";
import { SPRING } from "@/lib/motion";

type AppearanceMode = "SYSTEM" | "LIGHT" | "DARK";

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
 * Appearance preference as selectable glass cards. Optimistic: the
 * selection moves instantly, persists via saveSettings, and reverts
 * with a toast if the save fails. Honesty note: the product ships a
 * single dark theme today, so LIGHT/SYSTEM show a quiet note rather
 * than pretending a light theme is active.
 */
export function AppearancePicker({ initial }: { initial: AppearanceMode }) {
  const [value, setValue] = useState<AppearanceMode>(initial);
  const [pending, setPending] = useState(false);

  async function select(next: AppearanceMode) {
    if (next === value) return;
    const previous = value;
    setValue(next);
    setPending(true);

    const result = await saveSettings({ appearance: next });

    setPending(false);
    if (!result.ok) {
      setValue(previous);
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
            className="glass flex min-h-14 w-full items-center gap-4 rounded-3xl px-5 py-4 text-left outline-none transition-colors hover:bg-white/6 focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:border-white/25 data-[state=checked]:bg-white/6 data-[disabled]:opacity-70"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent">
              <Icon className="size-5 text-accent-foreground" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{label}</span>
              <span className="block truncate text-sm text-muted-foreground">{hint}</span>
            </span>
            <span className="flex size-6 shrink-0 items-center justify-center">
              <RadioGroupPrimitive.Indicator asChild>
                <motion.span
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={SPRING.snappy}
                  className="flex size-6 items-center justify-center rounded-full bg-primary"
                >
                  <Check className="size-3.5 text-primary-foreground" aria-hidden="true" />
                </motion.span>
              </RadioGroupPrimitive.Indicator>
            </span>
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>

      {value !== "DARK" ? (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SPRING.snappy}
          className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground/80"
        >
          Virelsy currently looks its best in the dark - a light theme is on the way.
        </motion.p>
      ) : null}
    </div>
  );
}
