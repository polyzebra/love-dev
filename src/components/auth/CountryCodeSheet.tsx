"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import {
  COUNTRIES,
  POPULAR_COUNTRIES,
  matchesCountry,
  type Country,
} from "@/lib/auth/countries";
import { cn } from "@/lib/utils";

/**
 * Country picker for the phone step. Mobile: vaul bottom sheet;
 * md+: centered dialog - the house pattern (see first-message-sheet).
 * Popular countries pinned first, then every country alphabetically;
 * search matches name, ISO code and dial code with or without "+"
 * (Ireland | IE | 353 | +353). Rows are 44px touch targets.
 */

/** md breakpoint - drawer below, dialog at and above. */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

export function CountryCodeSheet({
  open,
  onOpenChange,
  selectedIso,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIso: string;
  onSelect: (country: Country) => void;
}) {
  const isDesktop = useIsDesktop();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // A fresh search every time the sheet opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setQuery("");
  }

  const popular = useMemo(
    () => POPULAR_COUNTRIES.filter((c) => matchesCountry(c, query)),
    [query],
  );
  const all = useMemo(
    () => COUNTRIES.filter((c) => matchesCountry(c, query)),
    [query],
  );

  function pick(country: Country) {
    onSelect(country);
    onOpenChange(false);
  }

  const focusSearch = (e: Event) => {
    // Autofocusing search on mobile would summon the keyboard over the
    // list; only steal focus where there is no on-screen keyboard.
    e.preventDefault();
    if (isDesktop) searchRef.current?.focus();
  };

  const search = (
    <div className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={searchRef}
        type="text"
        inputMode="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search country or code"
        aria-label="Search countries"
        className="h-11 pl-10"
      />
    </div>
  );

  const list = (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-3 pb-4">
      {popular.length > 0 && (
        <CountryGroup
          label="Popular"
          countries={popular}
          selectedIso={selectedIso}
          onPick={pick}
        />
      )}
      {all.length > 0 && (
        <CountryGroup
          label="All countries"
          countries={all}
          selectedIso={selectedIso}
          onPick={pick}
        />
      )}
      {popular.length === 0 && all.length === 0 && (
        <p className="px-1 pt-6 text-center text-sm text-muted-foreground">
          No country matches &quot;{query}&quot;.
        </p>
      )}
    </div>
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="flex max-h-[min(40rem,85vh)] flex-col gap-0 sm:max-w-md"
          onOpenAutoFocus={focusSearch}
        >
          <DialogHeader className="pb-3">
            <DialogTitle className="font-display text-2xl font-medium">
              Country code
            </DialogTitle>
            <DialogDescription>Pick where your number is from.</DialogDescription>
          </DialogHeader>
          <div className="sticky top-0 z-10">{search}</div>
          {list}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="h-[85dvh] max-h-[85dvh] border-border bg-popover/95 backdrop-blur-2xl"
        onOpenAutoFocus={focusSearch}
      >
        <DrawerHeader className="pb-2">
          <DrawerTitle className="font-display text-2xl font-medium">
            Country code
          </DrawerTitle>
          <DrawerDescription>Pick where your number is from.</DrawerDescription>
        </DrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-[var(--safe-bottom)]">
          {search}
          {list}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function CountryGroup({
  label,
  countries,
  selectedIso,
  onPick,
}: {
  label: string;
  countries: Country[];
  selectedIso: string;
  onPick: (country: Country) => void;
}) {
  return (
    <div role="group" aria-label={label}>
      <p className="px-1 pb-1.5 text-xs font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </p>
      <ul className="space-y-0.5">
        {countries.map((country) => {
          const selected = country.iso === selectedIso;
          return (
            <li key={`${label}-${country.iso}`}>
              <button
                type="button"
                onClick={() => onPick(country)}
                aria-pressed={selected}
                className={cn(
                  // 44px target, neutral selected state: fill + check,
                  // never a rose outline.
                  "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-foreground/20",
                  selected
                    ? "bg-foreground/10 font-medium"
                    : "hover:bg-foreground/5",
                )}
              >
                <span className="text-xl leading-none" aria-hidden="true">
                  {country.flag}
                </span>
                <span className="min-w-0 flex-1 truncate">{country.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  {country.dialCode}
                </span>
                {selected && <Check className="size-4" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
