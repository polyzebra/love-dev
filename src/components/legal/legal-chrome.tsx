"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, Link2, Printer } from "lucide-react";
import { LEGAL_COMPANY, legalDocByPath, legalDocNeighbours } from "@/lib/legal/registry";
import { slugify } from "@/lib/legal/markdown";
import { layout } from "@/components/layout/public";
import { cn } from "@/lib/utils";

const NON_REGISTRY_LABELS: Record<string, string> = {
  "/safety": "Safety Centre",
  "/about": "About Tirvea",
};
function relatedTitle(path: string): string {
  return legalDocByPath(path)?.title ?? NON_REGISTRY_LABELS[path] ?? path;
}

/** Quiet middot separator for the metadata row. */
function Dot() {
  return (
    <span aria-hidden className="text-foreground/25">
      &middot;
    </span>
  );
}

/**
 * L4.0 - documentation typography. Reading is primary: generous measure and
 * spacing, a strong H1/H2/H3 hierarchy, and NO section-dividing borders (the
 * dashboard look). Colours and the type family are the Tirvea tokens,
 * unchanged - only the hierarchy and rhythm are elevated.
 */
const PROSE =
  "prose-neutral max-w-none " +
  "[&_h1]:font-display [&_h1]:text-4xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-foreground [&_h1]:md:text-5xl " +
  "[&_h2]:mt-16 [&_h2]:scroll-mt-28 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground " +
  "[&_h3]:mt-10 [&_h3]:scroll-mt-28 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-foreground " +
  "[&_p]:mt-5 [&_p]:leading-[1.8] [&_p]:text-muted-foreground " +
  "[&_li]:leading-[1.75] [&_li]:text-muted-foreground [&_ul]:mt-5 [&_ul]:list-disc [&_ul]:space-y-2.5 [&_ul]:pl-6 [&_ol]:mt-5 [&_ol]:list-decimal [&_ol]:space-y-2.5 [&_ol]:pl-6 " +
  "[&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:decoration-foreground/30 [&_a]:underline-offset-[3px] [&_a:hover]:decoration-foreground " +
  "[&_strong]:text-foreground [&_strong]:font-semibold " +
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.85em] " +
  "[&_hr]:my-14 [&_hr]:border-border/70 " +
  "[&_blockquote]:my-8 [&_blockquote]:border-l-2 [&_blockquote]:border-foreground/20 [&_blockquote]:pl-5 [&_blockquote]:text-muted-foreground [&_blockquote_p]:mt-0 [&_blockquote_p]:leading-[1.7] " +
  "[&_table]:my-8 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_thead]:border-b [&_thead]:border-border [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-foreground [&_td]:border-t [&_td]:border-border/50 [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top [&_td]:text-muted-foreground";

type Heading = { id: string; text: string; level: number };

export function LegalChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const articleRef = useRef<HTMLElement>(null);
  const tocRef = useRef<HTMLElement>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [readingMin, setReadingMin] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const isHub = pathname === "/legal";

  // Scan the rendered article for headings (assigning ids where missing, e.g.
  // legacy JSX pages) and compute reading time - so the ToC + metadata work
  // uniformly for markdown and legacy pages alike.
  useEffect(() => {
    if (isHub) return;
    const article = articleRef.current;
    if (!article) return;
    const els = Array.from(article.querySelectorAll<HTMLElement>("h2, h3"));
    const found: Heading[] = els.map((el) => {
      const text = el.textContent ?? "";
      if (!el.id) el.id = slugify(text);
      return { id: el.id, text, level: el.tagName === "H3" ? 3 : 2 };
    });
    setHeadings(found);
    const words = (article.textContent ?? "").trim().split(/\s+/).length;
    setReadingMin(Math.max(1, Math.round(words / 200)));
  }, [isHub, pathname]);

  // Scroll spy.
  useEffect(() => {
    if (headings.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-100px 0px -66% 0px", threshold: 0 },
    );
    headings.forEach((h) => {
      const el = document.getElementById(h.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [headings]);

  // Keep the active ToC item visible in the sticky (scrollable) desktop rail
  // as the reader scrolls a long document - without moving the page. Honours
  // reduced-motion (instant vs smooth).
  useEffect(() => {
    if (!activeId) return;
    const link = tocRef.current?.querySelector<HTMLElement>(`[data-toc-id="${activeId}"]`);
    if (!link) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    link.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [activeId]);

  if (isHub) return <>{children}</>;

  const doc = legalDocByPath(pathname);
  const { prev, next } = legalDocNeighbours(pathname);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  // Quiet utility controls - text + icon, no borders or pills.
  const utilityBtn =
    "inline-flex items-center gap-1.5 rounded text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20";

  const tocList = (onNavigate?: (e: MouseEvent<HTMLAnchorElement>) => void) => (
    <ul className="space-y-0.5 text-sm">
      {headings.map((h) => {
        const active = activeId === h.id;
        return (
          <li key={h.id} className={h.level === 3 ? "pl-3" : ""}>
            <a
              href={`#${h.id}`}
              data-toc-id={h.id}
              onClick={onNavigate}
              aria-current={active ? "location" : undefined}
              className={
                "block rounded-r border-l-2 py-1 pl-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 " +
                (active
                  ? "border-primary-soft bg-muted/50 font-semibold text-foreground"
                  : "border-border/50 text-muted-foreground hover:border-foreground/40 hover:text-foreground")
              }
            >
              {h.text}
            </a>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className={cn("mx-auto", layout.wide, layout.paddingX, layout.paddingTop, layout.paddingBottom)}>
      {/* Breadcrumbs + schema */}
      <nav aria-label="Breadcrumb" className="text-muted-foreground mb-6 text-xs print:hidden">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-foreground transition-colors">
              Home
            </Link>
          </li>
          <li aria-hidden="true" className="text-foreground/30">
            /
          </li>
          <li>
            <Link href="/legal" className="hover:text-foreground transition-colors">
              Legal Centre
            </Link>
          </li>
          {doc && (
            <>
              <li aria-hidden="true" className="text-foreground/30">
                /
              </li>
              {/* Current document: brand-coloured, semibold, non-clickable. */}
              <li aria-current="page" className="text-primary-soft font-semibold">
                {doc.title}
              </li>
            </>
          )}
        </ol>
      </nav>
      {doc && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Home", item: "/" },
                { "@type": "ListItem", position: 2, name: "Legal Centre", item: "/legal" },
                { "@type": "ListItem", position: 3, name: doc.title, item: doc.path },
              ],
            }),
          }}
        />
      )}

      {/* Minimal documentation meta row - no card, no badges. */}
      {doc && (
        <div className="mb-10 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 print:mb-6">
          <dl className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <dt className="sr-only">Publisher</dt>
            <dd className="text-foreground/70 font-medium">{LEGAL_COMPANY.entity}</dd>
            <Dot />
            <dt className="sr-only">Category</dt>
            <dd>{doc.category}</dd>
            <Dot />
            <dt className="sr-only">Effective date</dt>
            <dd>Effective {doc.effectiveDate || "pending"}</dd>
            <Dot />
            <dt className="sr-only">Last updated</dt>
            <dd>Updated {doc.lastUpdated}</dd>
            {readingMin ? (
              <>
                <Dot />
                <dd>{readingMin} min read</dd>
              </>
            ) : null}
          </dl>
          <div className="flex items-center gap-4 print:hidden">
            <button type="button" onClick={() => window.print()} className={utilityBtn}>
              <Printer aria-hidden className="size-3.5" /> Print
            </button>
            <button
              type="button"
              onClick={copyLink}
              className={utilityBtn}
              aria-live="polite"
              aria-label={copied ? "Link copied" : "Copy link to this page"}
            >
              {copied ? (
                <Check aria-hidden className="size-3.5" />
              ) : (
                <Link2 aria-hidden className="size-3.5" />
              )}
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      )}

      {/* Mobile ToC */}
      {headings.length > 0 && (
        <details className="border-border/70 bg-background/85 sticky top-20 z-20 mb-8 rounded-lg border backdrop-blur lg:hidden print:hidden">
          <summary className="text-foreground flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium">
            Contents
            <span className="text-muted-foreground text-xs">{headings.length} sections</span>
          </summary>
          <div className="max-h-[50vh] overflow-y-auto px-4 pb-4">
            {tocList((e) => {
              (e?.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute(
                "open",
              );
            })}
          </div>
        </details>
      )}

      {/* Body + desktop ToC */}
      <div className="lg:grid lg:grid-cols-[minmax(0,44rem)_15rem] lg:gap-16">
        <div className="min-w-0">
          <article ref={articleRef} className={PROSE}>
            {children}
          </article>

          {/* Related policies - simple documentation links, no cards. */}
          {doc && doc.related.length > 0 && (
            <section aria-labelledby="related-heading" className="mt-16 print:hidden">
              <h2
                id="related-heading"
                className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase"
              >
                Related policies
              </h2>
              <ul className="mt-5 grid gap-x-10 gap-y-3 sm:grid-cols-2">
                {doc.related.map((r) => {
                  // Active/Current: if a related target IS the current document,
                  // never render it as a normal link - mark it "Currently
                  // viewing" (distinguished by weight + label + colour, not
                  // colour alone), non-clickable.
                  const isCurrent = r === pathname;
                  return (
                    <li key={r}>
                      {isCurrent ? (
                        <span
                          aria-current="page"
                          className="text-primary-soft inline-flex items-center gap-2 text-sm font-semibold"
                        >
                          <span aria-hidden className="bg-primary-soft size-1.5 shrink-0 rounded-full" />
                          {relatedTitle(r)}
                          <span className="text-muted-foreground text-xs font-normal">
                            Currently viewing
                          </span>
                        </span>
                      ) : (
                        <Link
                          href={r}
                          className="text-foreground/80 hover:text-foreground group inline-flex items-center gap-1.5 rounded text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                        >
                          {relatedTitle(r)}
                          <span
                            aria-hidden
                            className="text-foreground/40 group-hover:text-foreground/70 motion-safe:transition-transform group-hover:translate-x-0.5"
                          >
                            &rarr;
                          </span>
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Version history - minimal, never dominant. */}
          {doc && doc.revisionHistory.length > 0 && (
            <section aria-labelledby="history-heading" className="mt-14">
              <h2
                id="history-heading"
                className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase"
              >
                Version history
              </h2>
              <ul className="mt-5 space-y-2.5 text-sm">
                {doc.revisionHistory.map((r) => (
                  <li
                    key={`${r.version}-${r.date}`}
                    className="text-muted-foreground flex flex-wrap items-baseline gap-x-3 gap-y-0.5"
                  >
                    <span className="text-foreground w-10 shrink-0 font-medium tabular-nums">
                      v{r.version}
                    </span>
                    <span className="tabular-nums">{r.date}</span>
                    <span className="text-foreground/60">{r.note}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Prev / next - destination cards that highlight on hover/focus,
              with a reduced-motion-safe arrow animation. */}
          {(prev || next) && (
            <nav
              aria-label="Legal document navigation"
              className="border-border/60 mt-16 grid gap-4 border-t pt-8 sm:grid-cols-2 print:hidden"
            >
              {prev ? (
                <Link
                  href={prev.path}
                  className="group border-border/50 hover:border-foreground/25 hover:bg-muted/30 rounded-xl border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                >
                  <span className="text-foreground/40 text-xs">Previous</span>
                  <span className="text-foreground/80 group-hover:text-foreground mt-1 flex items-center gap-1.5 text-sm font-medium">
                    <span
                      aria-hidden
                      className="motion-safe:transition-transform group-hover:-translate-x-0.5"
                    >
                      &larr;
                    </span>
                    {prev.title}
                  </span>
                </Link>
              ) : (
                <span className="hidden sm:block" />
              )}
              {next ? (
                <Link
                  href={next.path}
                  className="group border-border/50 hover:border-foreground/25 hover:bg-muted/30 rounded-xl border p-4 text-right transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 sm:col-start-2"
                >
                  <span className="text-foreground/40 text-xs">Next</span>
                  <span className="text-foreground/80 group-hover:text-foreground mt-1 flex items-center justify-end gap-1.5 text-sm font-medium">
                    {next.title}
                    <span
                      aria-hidden
                      className="motion-safe:transition-transform group-hover:translate-x-0.5"
                    >
                      &rarr;
                    </span>
                  </span>
                </Link>
              ) : null}
            </nav>
          )}

          <div className="mt-14 print:hidden">
            <Link
              href="/legal"
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              &larr; Back to Legal Centre
            </Link>
          </div>
        </div>

        {/* Desktop ToC */}
        {headings.length > 0 && (
          <aside className="hidden lg:block print:hidden">
            <nav
              ref={tocRef}
              aria-label="Table of contents"
              className="sticky top-32 max-h-[calc(100dvh-10rem)] overflow-y-auto"
            >
              <p className="text-muted-foreground mb-3 text-xs font-semibold tracking-[0.14em] uppercase">
                On this page
              </p>
              {tocList()}
            </nav>
          </aside>
        )}
      </div>
    </div>
  );
}
