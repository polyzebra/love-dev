"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";

const PREFS = [
  { key: "matches", label: "New matches", hint: "When you and someone like each other" },
  { key: "messages", label: "Messages", hint: "New messages from your matches" },
  { key: "likes", label: "Likes", hint: "When someone likes your profile" },
  { key: "superlikes", label: "Super Likes", hint: "When someone really likes your profile" },
  { key: "digest", label: "Weekly digest", hint: "Your week on Amora, summarised" },
  { key: "product", label: "Product updates", hint: "New features and improvements" },
] as const;

/**
 * Preferences persist to localStorage until push infrastructure lands;
 * the UI contract stays the same when they move server-side.
 */
export function NotificationPreferences() {
  const [state, setState] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(window.localStorage.getItem("amora:notifications") ?? "{}");
    } catch {
      return {};
    }
  });

  function toggle(key: string, value: boolean) {
    const next = { ...state, [key]: value };
    setState(next);
    window.localStorage.setItem("amora:notifications", JSON.stringify(next));
    toast.success("Preference saved.");
  }

  return (
    <Card className="rounded-3xl">
      <CardContent className="divide-y">
        {PREFS.map(({ key, label, hint }) => (
          <div key={key} className="flex items-center justify-between gap-4 py-4 first:pt-2 last:pb-2">
            <div className="space-y-0.5">
              <Label htmlFor={`pref-${key}`} className="text-base">
                {label}
              </Label>
              <p className="text-sm text-muted-foreground">{hint}</p>
            </div>
            <Switch
              id={`pref-${key}`}
              checked={state[key] ?? true}
              onCheckedChange={(v) => toggle(key, v)}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
