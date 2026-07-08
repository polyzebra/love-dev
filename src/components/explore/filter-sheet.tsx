"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger,
} from "@/components/ui/drawer";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** Bottom-sheet filters; state lives in the URL so results are shareable. */
export function ExploreFilterSheet() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [ages, setAges] = useState<[number, number]>([
    Number(params.get("ageMin") ?? 18), Number(params.get("ageMax") ?? 60),
  ]);
  const [country, setCountry] = useState(params.get("country") ?? "");
  const [verifiedOnly, setVerifiedOnly] = useState(params.get("verifiedOnly") === "true");

  function apply() {
    const q = new URLSearchParams();
    if (ages[0] > 18) q.set("ageMin", String(ages[0]));
    if (ages[1] < 60) q.set("ageMax", String(ages[1]));
    if (country) q.set("country", country);
    if (verifiedOnly) q.set("verifiedOnly", "true");
    router.push(`${pathname}?${q.toString()}`);
    setOpen(false);
  }

  const active = params.size > 0;

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="outline" className="rounded-full" aria-label="Filters">
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          Filters{active ? " · on" : ""}
        </Button>
      </DrawerTrigger>
      <DrawerContent className="border-border bg-popover/95 backdrop-blur-2xl">
        <DrawerHeader>
          <DrawerTitle className="font-display text-2xl font-medium">Refine</DrawerTitle>
        </DrawerHeader>
        <div className="space-y-7 px-6 pb-2">
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <Label>Age range</Label>
              <span className="tabular-nums text-muted-foreground">{ages[0]}-{ages[1]}</span>
            </div>
            <Slider min={18} max={60} value={ages} onValueChange={(v) => setAges(v as [number, number])} aria-label="Age range" />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Country</legend>
            <div className="flex gap-2">
              {[["", "Anywhere"], ["IE", "Ireland"], ["GB", "United Kingdom"]].map(([value, label]) => (
                <button
                  key={label} type="button" onClick={() => setCountry(value)}
                  className={cn(
                    // Calm selected state: accent tint + primary text on a
                    // neutral border - selection is the fill, never a rose
                    // border (rose borders read as errors).
                    "tap-target rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                    country === value
                      ? "border-border bg-accent text-foreground"
                      : "border-border text-muted-foreground hover:border-foreground/25 hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="flex items-center justify-between">
            <Label htmlFor="verified-only">Photo-verified only</Label>
            <Switch id="verified-only" checked={verifiedOnly} onCheckedChange={setVerifiedOnly} />
          </div>
        </div>
        <DrawerFooter className="flex-row gap-2 px-6 pb-8">
          <Button variant="ghost" className="flex-1 rounded-full" onClick={() => { router.push(pathname); setOpen(false); }}>
            Reset
          </Button>
          <Button className="flex-1 rounded-full" onClick={apply}>Apply</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
