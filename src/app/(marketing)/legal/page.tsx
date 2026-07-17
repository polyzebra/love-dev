import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_COMPANY, legalDocsByCategory } from "@/lib/legal/registry";

export const metadata: Metadata = {
  title: "Legal Centre",
  description:
    "Tirvea's Legal Centre — terms, privacy, safety, verification, and compliance policies operated by WiseWave Limited.",
};

export default function LegalCentrePage() {
  const groups = legalDocsByCategory();

  return (
    <main className="mx-auto max-w-5xl px-5 pt-36 pb-20 md:px-8 md:pt-44">
      <header className="max-w-2xl">
        <h1 className="font-display text-4xl font-semibold tracking-tight">Legal Centre</h1>
        <p className="text-muted-foreground mt-4 leading-relaxed">
          The policies and terms that govern your use of Tirvea. Tirvea is a platform operated by{" "}
          {LEGAL_COMPANY.entity}. Choose a document below to read more.
        </p>
      </header>

      {/* Company information */}
      <section
        aria-label="Company information"
        className="border-border text-muted-foreground mt-8 rounded-xl border p-5 text-sm leading-relaxed md:p-6"
      >
        <h2 className="text-foreground text-sm font-semibold">{LEGAL_COMPANY.entity}</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="text-foreground/70 text-xs uppercase">Company number</dt>
            <dd>
              {LEGAL_COMPANY.companyNumber} · {LEGAL_COMPANY.registrar}
            </dd>
          </div>
          <div>
            <dt className="text-foreground/70 text-xs uppercase">Registered office</dt>
            <dd>
              <address className="not-italic">{LEGAL_COMPANY.address.join(", ")}</address>
            </dd>
          </div>
          <div>
            <dt className="text-foreground/70 text-xs uppercase">Contact</dt>
            <dd>
              <a
                href={`mailto:${LEGAL_COMPANY.email}`}
                className="hover:text-foreground underline underline-offset-4"
              >
                {LEGAL_COMPANY.email}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-foreground/70 text-xs uppercase">Operating regions</dt>
            <dd>{LEGAL_COMPANY.jurisdictions.join(" · ")}</dd>
          </div>
        </dl>
      </section>

      {/* Document categories */}
      {groups.map((group) => (
        <section key={group.category} aria-label={group.category} className="mt-12">
          <h2 className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
            {group.category}
          </h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.docs.map((doc) => {
              const card = (
                <>
                  <span className="text-foreground flex items-center gap-2 font-medium">
                    {doc.title}
                    {doc.status === "draft" && (
                      <span className="border-border text-muted-foreground rounded-full border px-2 py-0.5 text-[10px] tracking-wide uppercase">
                        Draft
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground mt-1 block text-sm leading-relaxed">
                    {doc.summary}
                  </span>
                  <span className="text-muted-foreground/70 mt-3 block text-xs">
                    v{doc.version} · Updated {doc.lastUpdated}
                  </span>
                </>
              );
              const cls =
                "border-border hover:border-foreground/30 block h-full rounded-xl border p-4 transition-colors";
              return (
                <li key={doc.path}>
                  {doc.external ? (
                    <a href={doc.external} className={cls}>
                      {card}
                    </a>
                  ) : (
                    <Link href={doc.path} className={cls}>
                      {card}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
