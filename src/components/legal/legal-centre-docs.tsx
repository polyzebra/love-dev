"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Clock, Search } from "lucide-react";

export type HubDoc = {
  path: string;
  title: string;
  summary: string;
  category: string;
  version: string;
  lastUpdated: string;
  status: "draft" | "published";
  external?: string;
  readingMin?: number;
};

/**
 * L2.8 - the Legal Centre document explorer: client-side search + category
 * filtering over the registry, with enterprise document cards (status, version,
 * last updated, reading time). Data is supplied by the server hub page.
 */
export function LegalCentreDocs({ docs, categories }: { docs: HubDoc[]; categories: string[] }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string>("All");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter((d) => {
      const inCat = active === "All" || d.category === active;
      const inQuery =
        !q ||
        d.title.toLowerCase().includes(q) ||
        d.summary.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q);
      return inCat && inQuery;
    });
  }, [docs, query, active]);

  const groups = useMemo(
    () =>
      categories
        .map((c) => ({ category: c, docs: filtered.filter((d) => d.category === c) }))
        .filter((g) => g.docs.length > 0),
    [categories, filtered],
  );

  const chip = (label: string) => {
    const on = active === label;
    return (
      <button
        key={label}
        type="button"
        onClick={() => setActive(label)}
        aria-pressed={on}
        className={
          "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-foreground/20 focus-visible:outline-none " +
          (on
            ? "border-foreground bg-foreground text-background"
            : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground")
        }
      >
        {label}
      </button>
    );
  };

  return (
    <div className="mt-12">
      {/* Search */}
      <div className="relative max-w-md">
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search legal documents…"
          aria-label="Search legal documents"
          className="border-border bg-background focus-visible:border-foreground/30 w-full rounded-full border py-2.5 pr-4 pl-10 text-sm outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
        />
      </div>

      {/* Category filters */}
      <div className="mt-4 flex flex-wrap gap-2">
        {chip("All")}
        {categories.map((c) => chip(c))}
      </div>

      {/* Results */}
      {groups.length === 0 ? (
        <p className="text-muted-foreground mt-10 text-sm">
          No documents match “{query}”.{" "}
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setActive("All");
            }}
            className="text-foreground underline underline-offset-4"
          >
            Clear filters
          </button>
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.category} aria-label={group.category} className="mt-10">
            <h2 className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
              {group.category}
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.docs.map((doc) => {
                const inner = (
                  <>
                    <span className="text-foreground flex items-center gap-2 font-medium">
                      {doc.title}
                      {doc.status === "draft" && (
                        <span className="border-amber-500/40 text-amber-700 dark:text-amber-400 rounded-full border px-2 py-0.5 text-[10px] tracking-wide uppercase">
                          Draft
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground mt-1 block text-sm leading-relaxed">
                      {doc.summary}
                    </span>
                    <span className="text-muted-foreground/70 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span>v{doc.version}</span>
                      <span aria-hidden>·</span>
                      <span>Updated {doc.lastUpdated}</span>
                      {doc.readingMin && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="inline-flex items-center gap-1">
                            <Clock aria-hidden className="size-3" />
                            {doc.readingMin} min
                          </span>
                        </>
                      )}
                    </span>
                  </>
                );
                const cls =
                  "border-border hover:border-foreground/30 block h-full rounded-xl border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20";
                return (
                  <li key={doc.path}>
                    {doc.external ? (
                      <a href={doc.external} className={cls}>
                        {inner}
                      </a>
                    ) : (
                      <Link href={doc.path} className={cls}>
                        {inner}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
