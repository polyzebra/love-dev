import type { Metadata } from "next";

export const metadata: Metadata = { title: "Careers" };

export default function CareersPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 pt-36 pb-16 md:px-8 md:pt-44">
      <h1 className="font-display text-4xl font-semibold tracking-tight">Careers</h1>
      <div className="text-muted-foreground mt-6 space-y-4 leading-relaxed">
        <p>
          Tirvea is operated by WiseWave Limited, building a dating platform around trust,
          authenticity, and meaningful connection.
        </p>
        <p>
          We don’t have open roles listed right now. If you’re excited about safety-first product
          engineering, trust &amp; safety, or design, we’d still love to hear from you.
        </p>
        <p>
          Introduce yourself:{" "}
          <a className="text-foreground underline" href="mailto:info@tirvea.com">
            info@tirvea.com
          </a>
          .
        </p>
      </div>
    </main>
  );
}
