import type { Metadata } from "next";
import { PageShell } from "@/components/layout/public";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { HELP_CATEGORIES, getHelpCategory } from "@/lib/help/content";

export function generateStaticParams() {
  return HELP_CATEGORIES.map((c) => ({ category: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const cat = getHelpCategory(category);
  if (!cat) return { title: "Help Centre" };
  return {
    title: `${cat.title} · Help Centre`,
    description: cat.summary,
    alternates: { canonical: `/help/${cat.slug}` },
  };
}

export default async function HelpCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  const cat = getHelpCategory(category);
  if (!cat) notFound();

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
          <li aria-current="page" className="text-foreground">
            {cat.title}
          </li>
        </ol>
      </nav>

      <h1 className="font-display mt-4 text-4xl font-semibold tracking-tight">{cat.title}</h1>
      <p className="text-muted-foreground mt-3 leading-relaxed">{cat.summary}</p>

      {cat.articles.length > 0 ? (
        <ul className="mt-8 space-y-3">
          {cat.articles.map((article) => (
            <li key={article.slug}>
              <Link
                href={`/help/${cat.slug}/${article.slug}`}
                className="border-border hover:border-foreground/25 focus-visible:ring-ring/60 block rounded-2xl border p-5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <h2 className="text-foreground font-semibold">{article.title}</h2>
                <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                  {article.summary}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground border-border mt-8 rounded-2xl border border-dashed p-6 text-sm">
          There are no articles in this category yet. See the resources below or{" "}
          <Link href="/contact" className="text-foreground underline">
            contact us
          </Link>
          .
        </p>
      )}

      {cat.resources.length > 0 ? (
        <section aria-labelledby="resources" className="mt-10">
          <h2 id="resources" className="text-foreground text-sm font-semibold">
            Related policies &amp; pages
          </h2>
          <ul className="mt-3 space-y-1.5">
            {cat.resources.map((r) => (
              <li key={r.href}>
                <Link
                  href={r.href}
                  className="text-foreground/80 hover:text-foreground text-sm underline underline-offset-4"
                >
                  {r.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </PageShell>
  );
}
