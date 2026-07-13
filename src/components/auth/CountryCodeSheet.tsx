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
import { COUNTRIES, POPULAR_COUNTRIES, matchesCountry, type Country } from "@/lib/auth/countries";
import { cn } from "@/lib/utils";

/**
 * Country picker for the phone step. Mobile: vaul bottom sheet;
 * md+: centered dialog - the house pattern (see first-message-sheet).
 * Popular countries pinned first, then every country alphabetically;
 * search matches name, ISO code and dial code with or without "+"
 * (Ireland | IE | 353 | +353). Rows are 44px touch targets with a
 * roving tabindex: Tab reaches the list once (the selected row when
 * visible), ArrowUp/ArrowDown/Home/End move between rows, ArrowDown
 * from the search box drops into the results. Focus trap, Esc/backdrop
 * close and background-scroll locking come from the Dialog/Drawer
 * primitives.
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
  isos,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIso: string;
  onSelect: (country: Country) => void;
  /**
   * Optional ISO restriction - the server-resolved supported list
   * (getSupportedPhoneCountries) the pages pass down. When set the
   * sheet renders the allowed popular countries as the pinned "Popular"
   * group, then the remaining allowed countries alphabetically (deduped
   * - a pinned country is not repeated below); omitted = every dialable
   * country (the default flow).
   */
  isos?: readonly string[];
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

  // Restricted mode: the allowed popular countries stay pinned as the
  // "Popular" group, the remaining allowed countries follow
  // alphabetically (deduped - unlike the unrestricted default, a pinned
  // country is not repeated below). A plain list is deliberate: at the
  // full dataset's 245 rows of flat 44px buttons, rendering and
  // scrolling are well within budget - virtualization would only add
  // complexity and break find-in-page/accessibility.
  const restricted = useMemo(() => {
    if (!isos) return null;
    const allowed = new Set(isos.map((iso) => iso.toUpperCase()));
    const pinned = POPULAR_COUNTRIES.filter((c) => allowed.has(c.iso));
    const pinnedIsos = new Set(pinned.map((c) => c.iso as string));
    return {
      pinned,
      rest: COUNTRIES.filter((c) => allowed.has(c.iso) && !pinnedIsos.has(c.iso)),
    };
  }, [isos]);

  const popular = useMemo(
    () =>
      (restricted ? restricted.pinned : POPULAR_COUNTRIES).filter((c) => matchesCountry(c, query)),
    [query, restricted],
  );
  const all = useMemo(
    () => (restricted ? restricted.rest : COUNTRIES).filter((c) => matchesCountry(c, query)),
    [query, restricted],
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

  const listRef = useRef<HTMLDivElement>(null);

  // Roving focus: ONE row is tabbable (the current selection when
  // visible, else the first row) - Tab lands on the list once, arrows
  // move within it. The Popular group can repeat a country from the
  // main list, so the roving target is a flat INDEX, not an ISO.
  const flatRows = useMemo(() => [...popular, ...all], [popular, all]);
  const selectedFlatIndex = flatRows.findIndex((c) => c.iso === selectedIso);
  const rovingIndex = selectedFlatIndex === -1 ? 0 : selectedFlatIndex;

  const rowsOf = (root: HTMLElement) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>("[data-country-row]"));

  function onListKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const rows = rowsOf(e.currentTarget);
    if (rows.length === 0) return;
    e.preventDefault();
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? rows.length - 1
          : e.key === "ArrowDown"
            ? Math.min(current + 1, rows.length - 1)
            : Math.max(current - 1, 0);
    rows[next]?.focus();
    rows[next]?.scrollIntoView({ block: "nearest" });
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // ArrowDown from the search box drops straight into the results.
    if (e.key !== "ArrowDown" || !listRef.current) return;
    const rows = rowsOf(listRef.current);
    if (rows.length === 0) return;
    e.preventDefault();
    rows[0].focus();
    rows[0].scrollIntoView({ block: "nearest" });
  }

  const search = (
    <div className="relative">
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2"
        aria-hidden="true"
      />
      <Input
        ref={searchRef}
        type="text"
        inputMode="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onSearchKeyDown}
        placeholder="Search country or code"
        aria-label="Search countries"
        className="h-11 pl-10"
      />
    </div>
  );

  const list = (
    <div
      ref={listRef}
      onKeyDown={onListKeyDown}
      className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-3 pb-4"
    >
      {popular.length > 0 && (
        <CountryGroup
          label="Popular"
          countries={popular}
          selectedIso={selectedIso}
          onPick={pick}
          startIndex={0}
          rovingIndex={rovingIndex}
        />
      )}
      {all.length > 0 && (
        <CountryGroup
          label={restricted ? "Available countries" : "All countries"}
          countries={all}
          selectedIso={selectedIso}
          onPick={pick}
          startIndex={popular.length}
          rovingIndex={rovingIndex}
        />
      )}
      {popular.length === 0 && all.length === 0 && (
        <p className="text-muted-foreground px-1 pt-6 text-center text-sm">
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
            <DialogTitle className="font-display text-2xl font-medium">Country code</DialogTitle>
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
        className="border-border bg-popover/95 h-[85dvh] max-h-[85dvh] backdrop-blur-2xl"
        onOpenAutoFocus={focusSearch}
      >
        <DrawerHeader className="pb-2">
          <DrawerTitle className="font-display text-2xl font-medium">Country code</DrawerTitle>
          <DrawerDescription>Pick where your number is from.</DrawerDescription>
        </DrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col px-4">
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
  startIndex,
  rovingIndex,
}: {
  label: string;
  countries: Country[];
  selectedIso: string;
  onPick: (country: Country) => void;
  /** Flat index of this group's first row across all groups. */
  startIndex: number;
  /** The single tabbable row's flat index (roving tabindex). */
  rovingIndex: number;
}) {
  return (
    <div role="group" aria-label={label}>
      <p className="text-muted-foreground px-1 pb-1.5 text-xs font-medium tracking-wider uppercase">
        {label}
      </p>
      <ul className="space-y-0.5">
        {countries.map((country, i) => {
          const selected = country.iso === selectedIso;
          return (
            <li key={`${label}-${country.iso}`}>
              <button
                type="button"
                data-country-row
                tabIndex={startIndex + i === rovingIndex ? 0 : -1}
                onClick={() => onPick(country)}
                aria-pressed={selected}
                className={cn(
                  // 44px target, neutral selected state: fill + check,
                  // never a rose outline.
                  "focus-visible:ring-foreground/20 flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-2",
                  selected ? "bg-foreground/10 font-medium" : "hover:bg-foreground/5",
                )}
              >
                <span className="text-xl leading-none" aria-hidden="true">
                  {country.flag}
                </span>
                <span className="min-w-0 flex-1 truncate">{country.name}</span>
                <span className="text-muted-foreground tabular-nums">{country.dialCode}</span>
                {selected && <Check className="size-4" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
