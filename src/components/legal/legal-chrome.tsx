"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { legalDocByPath, legalDocNeighbours } from "@/lib/legal/registry";

const NON_REGISTRY_LABELS: Record<string, string> = {
  "/safety": "Safety Centre",
  "/about": "About Tirvea",
};
function relatedLabel(path: string): string {
  return legalDocByPath(path)?.title ?? NON_REGISTRY_LABELS[path] ?? path;
}

const PROSE =
  "prose-neutral [&_h1]:font-display [&_p]:text-muted-foreground [&_li]:text-muted-foreground [&_h1]:text-4xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_p]:mt-4 [&_p]:leading-relaxed [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4";

/**
 * Shared chrome for every /legal/* document: breadcrumbs, a canonical metadata
 * strip, the prose body, and back / previous / next / related navigation, all
 * driven by the legal registry. The Legal Centre hub (/legal) opts out and
 * renders itself.
 */
export function LegalChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/legal") return <>{children}</>;

  const doc = legalDocByPath(pathname);
  const { prev, next } = legalDocNeighbours(pathname);
  const chip =
    "border-border text-foreground/80 hover:text-foreground hover:border-foreground/30 rounded-full border px-3 py-1 text-xs transition-colors";

  return (
    <div className="mx-auto max-w-3xl px-5 pt-36 pb-16 md:px-8 md:pt-44">
      <nav aria-label="Breadcrumb" className="text-muted-foreground mb-6 text-xs">
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
        <p className="text-muted-foreground mb-8 text-xs">
          Version {doc.version} · Effective {doc.effectiveDate} · Last updated {doc.lastUpdated}
          {doc.status === "draft" ? " · Draft — being finalised" : ""}
        </p>
      )}

      <article className={PROSE}>{children}</article>

      <nav
        aria-label="Legal document navigation"
        className="border-border mt-12 border-t pt-8 text-sm"
      >
        <Link
          href="/legal"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to Legal Centre
        </Link>

        {(prev || next) && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {prev ? (
              <Link
                href={prev.path}
                className="border-border hover:border-foreground/30 rounded-lg border p-4 transition-colors"
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
                className="border-border hover:border-foreground/30 rounded-lg border p-4 text-right transition-colors sm:col-start-2"
              >
                <span className="text-muted-foreground text-xs">Next</span>
                <span className="text-foreground mt-1 block">{next.title} →</span>
              </Link>
            ) : null}
          </div>
        )}

        {doc && doc.related.length > 0 && (
          <div className="mt-8">
            <h2 className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
              Related policies
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {doc.related.map((r) => (
                <li key={r}>
                  <Link href={r} className={chip}>
                    {relatedLabel(r)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>
    </div>
  );
}
