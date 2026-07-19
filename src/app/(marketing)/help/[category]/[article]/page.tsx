import type { Metadata } from "next";
import { PageShell } from "@/components/layout/public";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { HELP_CATEGORIES, getHelpArticle, relatedArticles } from "@/lib/help/content";

export function generateStaticParams() {
  return HELP_CATEGORIES.flatMap((c) =>
    c.articles.map((a) => ({ category: c.slug, article: a.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string; article: string }>;
}): Promise<Metadata> {
  const { category, article } = await params;
  const found = getHelpArticle(category, article);
  if (!found) return { title: "Help Centre" };
  return {
    title: `${found.article.title} · Help Centre`,
    description: found.article.summary,
    alternates: { canonical: `/help/${found.category.slug}/${found.article.slug}` },
  };
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ category: string; article: string }>;
}) {
  const { category, article } = await params;
  const found = getHelpArticle(category, article);
  if (!found) notFound();
  const { category: cat, article: doc } = found;
  const related = relatedArticles(cat.slug, doc.slug);

  return (
    <PageShell width="reading">
      <nav aria-label="Breadcrumb" className="text-muted-foreground text-sm">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link href="/help" className="hover:text-foreground underline underline-offset-4">
              Help Centre
            </Link>
          </li>
          <ChevronRight className="size-3.5" aria-hidden="true" />
          <li>
            <Link
              href={`/help/${cat.slug}`}
              className="hover:text-foreground underline underline-offset-4"
            >
              {cat.title}
            </Link>
          </li>
          <ChevronRight className="size-3.5" aria-hidden="true" />
          <li aria-current="page" className="text-foreground">
            {doc.title}
          </li>
        </ol>
      </nav>

      <article className="mt-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">
          {doc.title}
        </h1>
        <p className="text-muted-foreground mt-3 leading-relaxed">{doc.summary}</p>

        <div className="mt-6 space-y-4">
          {doc.blocks.map((block, i) => {
            if (block.kind === "p") {
              return (
                <p key={i} className="text-muted-foreground leading-relaxed">
                  {block.text}
                </p>
              );
            }
            if (block.kind === "list") {
              return (
                <ul key={i} className="text-muted-foreground list-disc space-y-2 pl-5 leading-relaxed">
                  {block.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              );
            }
            return (
              <ul key={i} className="space-y-1.5">
                {block.items.map((l) => (
                  <li key={l.href + l.label}>
                    <Link
                      href={l.href}
                      className="text-foreground/80 hover:text-foreground text-sm underline underline-offset-4"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            );
          })}
        </div>
      </article>

      {related.length > 0 ? (
        <section aria-labelledby="related" className="border-border mt-12 border-t pt-8">
          <h2 id="related" className="text-foreground text-sm font-semibold">
            Related articles
          </h2>
          <ul className="mt-3 space-y-1.5">
            {related.map((r) => (
              <li key={r.slug}>
                <Link
                  href={`/help/${cat.slug}/${r.slug}`}
                  className="text-foreground/80 hover:text-foreground text-sm underline underline-offset-4"
                >
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-muted-foreground mt-10 text-sm">
        Didn&apos;t find what you needed?{" "}
        <Link href="/contact" className="text-foreground underline">
          Contact us
        </Link>
        .
      </p>
    </PageShell>
  );
}
