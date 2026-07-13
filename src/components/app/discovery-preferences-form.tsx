"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const GENDER_OPTIONS = [
  { value: "WOMAN", label: "Women" },
  { value: "MAN", label: "Men" },
  { value: "NON_BINARY", label: "Non-binary people" },
  { value: "OTHER", label: "Everyone else" },
] as const;

export type DiscoveryPrefs = {
  interestedIn: string[];
  minAge: number;
  maxAge: number;
  maxDistanceKm: number;
  isVisible: boolean;
};

export function DiscoveryPreferencesForm({ initial }: { initial: DiscoveryPrefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (prefs.interestedIn.length === 0) {
      toast.error("Choose at least one option for who you want to see.");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/profile/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error("Couldn't save preferences. Try again.");
      return;
    }
    toast.success("Preferences saved.");
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-base">Show me</CardTitle>
          <CardDescription>Who appears in your Discover feed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {GENDER_OPTIONS.map((option) => (
            <div key={option.value} className="flex items-center gap-3">
              <Checkbox
                id={`gender-${option.value}`}
                checked={prefs.interestedIn.includes(option.value)}
                onCheckedChange={(checked) =>
                  setPrefs((p) => ({
                    ...p,
                    interestedIn: checked
                      ? [...p.interestedIn, option.value]
                      : p.interestedIn.filter((g) => g !== option.value),
                  }))
                }
              />
              <Label htmlFor={`gender-${option.value}`} className="font-normal">
                {option.label}
              </Label>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-base">Age range</CardTitle>
          <CardDescription aria-live="polite">
            {prefs.minAge} – {prefs.maxAge === 99 ? "99+" : prefs.maxAge}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Slider
            value={[prefs.minAge, prefs.maxAge]}
            min={18}
            max={99}
            step={1}
            aria-label="Age range"
            onValueChange={([min, max]) => setPrefs((p) => ({ ...p, minAge: min, maxAge: max }))}
          />
        </CardContent>
      </Card>

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-base">Maximum distance</CardTitle>
          <CardDescription aria-live="polite">{prefs.maxDistanceKm} km</CardDescription>
        </CardHeader>
        <CardContent>
          <Slider
            value={[prefs.maxDistanceKm]}
            min={1}
            max={500}
            step={1}
            aria-label="Maximum distance in kilometres"
            onValueChange={([km]) => setPrefs((p) => ({ ...p, maxDistanceKm: km }))}
          />
        </CardContent>
      </Card>

      <Card className="rounded-3xl">
        <CardContent className="flex items-center justify-between py-5">
          <div className="space-y-0.5 pr-4">
            <Label htmlFor="visible" className="text-base">
              Show me in Discover
            </Label>
            <p className="text-muted-foreground text-sm">
              Turn off to pause new matches. Existing chats stay open.
            </p>
          </div>
          <Switch
            id="visible"
            checked={prefs.isVisible}
            onCheckedChange={(isVisible) => setPrefs((p) => ({ ...p, isVisible }))}
          />
        </CardContent>
      </Card>

      <Button size="lg" className="h-12 w-full rounded-3xl" onClick={save} disabled={saving}>
        {saving ? <Loader2 className="size-4 animate-spin" /> : null}
        Save preferences
      </Button>
    </div>
  );
}
