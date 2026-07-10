"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Play, Vibrate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { saveSettings } from "@/app/(app)/settings/actions";
import { playMessageSound, preloadMessageSound, vibrate } from "@/lib/notifications/sound";
import { SPRING } from "@/lib/motion";

type Field = "inAppVibrations" | "inAppSounds";

/** Capability probes never change during a page's life - no updates. */
function subscribeNever(): () => void {
  return () => undefined;
}

/**
 * The hub's In-app section: the same optimistic toggle rows as
 * SettingsToggleList, plus honest device probes - a real "play test
 * sound" button and a vibration row that admits when the browser has
 * no vibration API instead of pretending.
 */
export function InAppFeedbackSettings({
  initial,
}: {
  initial: { inAppVibrations: boolean; inAppSounds: boolean };
}) {
  const [values, setValues] = useState<Record<Field, boolean>>({
    inAppVibrations: initial.inAppVibrations,
    inAppSounds: initial.inAppSounds,
  });
  const [pending, setPending] = useState<ReadonlySet<Field>>(new Set());
  // null during SSR/hydration, then the real probe - no mismatch.
  const vibrationSupported = useSyncExternalStore(
    subscribeNever,
    () => "vibrate" in navigator,
    () => null,
  );

  useEffect(() => {
    preloadMessageSound();
  }, []);

  async function toggle(field: Field, next: boolean) {
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

  const rows: {
    field: Field;
    label: string;
    hint: string;
    disabled?: boolean;
    onTest?: () => void;
    testLabel?: string;
    testIcon?: typeof Play;
  }[] = [
    {
      field: "inAppVibrations",
      label: "Vibrations",
      hint:
        vibrationSupported === false
          ? "Vibration is not available in this browser."
          : "Subtle haptics on key moments.",
      disabled: vibrationSupported === false,
      onTest:
        vibrationSupported === true
          ? () => {
              if (!vibrate(true, 30)) toast("This device didn't vibrate.");
            }
          : undefined,
      testLabel: "Test vibration",
      testIcon: Vibrate,
    },
    {
      field: "inAppSounds",
      label: "Sounds",
      hint: "Soft sounds for matches and messages.",
      onTest: () => playMessageSound(true),
      testLabel: "Play test sound",
      testIcon: Play,
    },
  ];

  return (
    <div className="glass overflow-hidden rounded-3xl">
      {rows.map(({ field, label, hint, disabled, onTest, testLabel, testIcon: TestIcon }, i) => (
        <div
          key={field}
          className={`flex min-h-14 items-center gap-3 px-5 py-4 ${i > 0 ? "border-t border-border" : ""}`}
        >
          <div className="min-w-0 flex-1 space-y-0.5">
            <Label htmlFor={`setting-${field}`} className="text-base">
              {label}
            </Label>
            <p className="text-sm text-muted-foreground">{hint}</p>
          </div>
          {onTest && TestIcon ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={testLabel}
              title={testLabel}
              className="size-9 shrink-0 rounded-full"
              onClick={onTest}
            >
              <TestIcon className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
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
              disabled={disabled || pending.has(field)}
              onCheckedChange={(checked) => toggle(field, checked)}
            />
          </motion.span>
        </div>
      ))}
    </div>
  );
}
