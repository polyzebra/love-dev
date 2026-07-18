"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, Clock, FileDown, Link2, Printer } from "lucide-react";
import { LEGAL_COMPANY, legalDocByPath, legalDocNeighbours } from "@/lib/legal/registry";
import { slugify } from "@/lib/legal/markdown";

const NON_REGISTRY_LABELS: Record<string, string> = {
  "/safety": "Safety Centre",
  "/about": "About Tirvea",
};
function relatedTitle(path: string): string {
  return legalDocByPath(path)?.title ?? NON_REGISTRY_LABELS[path] ?? path;
}
function relatedSummary(path: string): string | undefined {
  return legalDocByPath(path)?.summary;
}

const PROSE =
  "prose-neutral max-w-none [&_h1]:font-display [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:md:text-4xl [&_h2]:mt-12 [&_h2]:scroll-mt-28 [&_h2]:border-t [&_h2]:border-border/60 [&_h2]:pt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-8 [&_h3]:scroll-mt-28 [&_h3]:text-base [&_h3]:font-semibold [&_p]:mt-4 [&_p]:leading-7 [&_p]:text-muted-foreground [&_li]:text-muted-foreground [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:decoration-foreground/30 [&_a]:underline-offset-[3px] [&_a:hover]:decoration-foreground [&_strong]:text-foreground [&_strong]:font-semibold [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_hr]:my-10 [&_hr]:border-border [&_blockquote]:my-6 [&_blockquote]:rounded-r-lg [&_blockquote]:border-l-2 [&_blockquote]:border-foreground/25 [&_blockquote]:bg-muted/40 [&_blockquote]:py-3 [&_blockquote]:pr-4 [&_blockquote]:pl-4 [&_blockquote_p]:mt-0 [&_table]:my-6 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_thead]:bg-muted/50 [&_th]:border [&_th]:border-border [&_th]:p-2.5 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-border [&_td]:p-2.5 [&_td]:align-top [&_td]:text-muted-foreground";

type Heading = { id: string; text: string; level: number };

export function LegalChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const articleRef = useRef<HTMLElement>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [readingMin, setReadingMin] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const isHub = pathname === "/legal";

  // Scan the rendered article for headings (assigning ids where missing, e.g.
  // legacy JSX pages) and compute reading time — so the ToC + metadata bar work
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

  if (isHub) return <>{children}</>;

  const doc = legalDocByPath(pathname);
  const { prev, next } = legalDocNeighbours(pathname);
  const isDraft = doc?.status === "draft";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const actionBtn =
    "inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 disabled:cursor-not-allowed disabled:opacity-50";

  const tocList = (onNavigate?: (e: MouseEvent<HTMLAnchorElement>) => void) => (
    <ul className="space-y-1.5 text-sm">
      {headings.map((h) => (
        <li key={h.id} className={h.level === 3 ? "pl-3" : ""}>
          <a
            href={`#${h.id}`}
            onClick={onNavigate}
            aria-current={activeId === h.id ? "location" : undefined}
            className={
              "block border-l-2 py-0.5 pl-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 " +
              (activeId === h.id
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground")
            }
          >
            {h.text}
          </a>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="mx-auto max-w-[64rem] px-5 pt-28 pb-20 md:px-8 md:pt-36">
      {/* Breadcrumbs + schema */}
      <nav aria-label="Breadcrumb" className="text-muted-foreground mb-5 text-xs print:hidden">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-foreground transition-colors">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href="/legal" className="hover:text-foreground transition-colors">
              Legal Centre
            </Link>
          </li>
          {doc && (
            <>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="text-foreground/80">
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

      {/* Metadata + action bar */}
      {doc && (
        <div className="border-border bg-muted/30 mb-8 rounded-xl border p-4 md:p-5 print:mb-4 print:border-0 print:bg-transparent print:p-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            <span className="border-border text-foreground/70 rounded-full border px-2.5 py-0.5 font-medium">
              {doc.category}
            </span>
            <span
              className={
                "rounded-full border px-2.5 py-0.5 font-medium tracking-wide uppercase " +
                (isDraft
                  ? "border-amber-500/40 text-amber-700 dark:text-amber-400"
                  : "border-emerald-500/40 text-emerald-700 dark:text-emerald-400")
              }
            >
              {isDraft ? "Draft · under review" : "Published"}
            </span>
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <Clock aria-hidden className="size-3.5" />
              {readingMin ? `${readingMin} min read` : "…"}
            </span>
          </div>
          <dl className="text-muted-foreground mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <div className="flex gap-1.5">
              <dt className="text-foreground/50">Version</dt>
              <dd>{doc.version}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-foreground/50">Effective</dt>
              <dd>{doc.effectiveDate || "Pending publication"}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-foreground/50">Last updated</dt>
              <dd>{doc.lastUpdated}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-2 print:hidden">
            <button type="button" onClick={() => window.print()} className={actionBtn}>
              <Printer aria-hidden className="size-3.5" /> Print
            </button>
            <button
              type="button"
              onClick={copyLink}
              className={actionBtn}
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
            <button
              type="button"
              disabled
              title="PDF export — coming soon"
              className={actionBtn}
            >
              <FileDown aria-hidden className="size-3.5" /> Download PDF
            </button>
            <span className="text-foreground/40 ml-auto hidden text-[11px] sm:inline">
              {LEGAL_COMPANY.entity} · Company No. {LEGAL_COMPANY.companyNumber}
            </span>
          </div>
        </div>
      )}

      {/* Mobile ToC */}
      {headings.length > 0 && (
        <details className="border-border bg-background/80 sticky top-20 z-20 mb-6 rounded-lg border backdrop-blur lg:hidden print:hidden">
          <summary className="text-foreground flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium">
            On this page
            <span className="text-muted-foreground text-xs">{headings.length} sections</span>
          </summary>
          <div className="max-h-[50vh] overflow-y-auto px-4 pb-4">
            {tocList((e) => {
              // close the disclosure after tapping a link
              (e?.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute(
                "open",
              );
            })}
          </div>
        </details>
      )}

      {/* Body + desktop ToC */}
      <div className="lg:grid lg:grid-cols-[minmax(0,46rem)_14rem] lg:gap-12">
        <div className="min-w-0">
          <article ref={articleRef} className={PROSE}>
            {children}
          </article>

          {/* Related policies */}
          {doc && doc.related.length > 0 && (
            <section aria-label="Related policies" className="mt-14 print:hidden">
              <h2 className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
                Related policies
              </h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {doc.related.map((r) => (
                  <li key={r}>
                    <Link
                      href={r}
                      className="border-border hover:border-foreground/30 block h-full rounded-xl border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                    >
                      <span className="text-foreground block text-sm font-medium">
                        {relatedTitle(r)}
                      </span>
                      {relatedSummary(r) && (
                        <span className="text-muted-foreground mt-1 block text-xs leading-relaxed">
                          {relatedSummary(r)}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Revision history */}
          {doc && doc.revisionHistory.length > 0 && (
            <section aria-label="Revision history" className="mt-12">
              <h2 className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
                Revision history
              </h2>
              <ul className="border-border mt-4 divide-y overflow-hidden rounded-xl border text-sm">
                {doc.revisionHistory.map((r) => {
                  const current = r.version === doc.version;
                  return (
                    <li
                      key={`${r.version}-${r.date}`}
                      className={
                        "flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 " +
                        (current ? "bg-muted/40" : "")
                      }
                    >
                      <span className="text-foreground font-medium">v{r.version}</span>
                      {current && (
                        <span className="rounded-full border border-emerald-500/40 px-2 py-0.5 text-[10px] font-medium tracking-wide text-emerald-700 uppercase dark:text-emerald-400">
                          Current
                        </span>
                      )}
                      <span className="text-muted-foreground text-xs">{r.date}</span>
                      <span className="text-muted-foreground w-full text-xs sm:w-auto sm:flex-1">
                        {r.note}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Prev / next */}
          {(prev || next) && (
            <nav
              aria-label="Legal document navigation"
              className="border-border mt-12 grid gap-4 border-t pt-8 sm:grid-cols-2 print:hidden"
            >
              {prev ? (
                <Link
                  href={prev.path}
                  className="border-border hover:border-foreground/30 rounded-lg border p-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                >
                  <span className="text-muted-foreground text-xs">Previous</span>
                  <span className="text-foreground mt-1 block">← {prev.title}</span>
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link
                  href={next.path}
                  className="border-border hover:border-foreground/30 rounded-lg border p-4 text-right text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 sm:col-start-2"
                >
                  <span className="text-muted-foreground text-xs">Next</span>
                  <span className="text-foreground mt-1 block">{next.title} →</span>
                </Link>
              ) : null}
            </nav>
          )}

          {/* Feedback + copy (future-ready enterprise features) */}
          <PageFeedback onCopy={copyLink} copied={copied} />

          <div className="mt-10 print:hidden">
            <Link
              href="/legal"
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              ← Back to Legal Centre
            </Link>
          </div>
        </div>

        {/* Desktop ToC */}
        {headings.length > 0 && (
          <aside className="hidden lg:block print:hidden">
            <nav
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

function PageFeedback({ onCopy, copied }: { onCopy: () => void; copied: boolean }) {
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  return (
    <div className="border-border mt-12 flex flex-wrap items-center justify-between gap-4 border-t pt-6 print:hidden">
      <div className="flex items-center gap-3 text-sm">
        {vote ? (
          <span className="text-muted-foreground">Thanks for your feedback.</span>
        ) : (
          <>
            <span className="text-muted-foreground">Was this page helpful?</span>
            <button
              type="button"
              onClick={() => setVote("up")}
              className="border-border hover:border-foreground/30 hover:text-foreground rounded-full border px-3 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-foreground/20 focus-visible:outline-none"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => setVote("down")}
              className="border-border hover:border-foreground/30 hover:text-foreground rounded-full border px-3 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-foreground/20 focus-visible:outline-none"
            >
              No
            </button>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onCopy}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-foreground/20 focus-visible:outline-none"
      >
        {copied ? <Check aria-hidden className="size-3.5" /> : <Link2 aria-hidden className="size-3.5" />}
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
