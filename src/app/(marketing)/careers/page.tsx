import type { Metadata } from "next";
import Link from "next/link";
import { buildMarketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "Careers",
  description:
    "Careers at Tirvea, operated by WiseWave Limited. We are not actively hiring right now, but we welcome thoughtful introductions.",
  path: "/careers",
});

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="font-display text-2xl font-semibold tracking-tight">
        {title}
      </h2>
      <div className="text-muted-foreground mt-3 space-y-3 leading-relaxed">{children}</div>
    </section>
  );
}

export default function CareersPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 pt-36 pb-20 md:px-8 md:pt-44">
      <h1 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">Careers</h1>
      <p className="text-muted-foreground mt-5 text-lg leading-relaxed">
        Tirvea is operated by <strong>WiseWave Limited</strong>, building a dating platform around
        trust, authenticity, and meaningful connection.
      </p>

      {/* Professional, honest empty state - no fabricated roles or apply buttons. */}
      <div className="border-border mt-8 rounded-3xl border p-6">
        <h2 className="text-foreground text-lg font-semibold">Open roles</h2>
        <p className="text-muted-foreground mt-2 leading-relaxed">
          We don&apos;t have any open positions listed right now. We&apos;re a small team and hire
          deliberately - when we do open a role, it will appear here.
        </p>
      </div>

      <Section id="general-applications" title="General applications">
        <p>
          If you&apos;re excited about safety-first product engineering, trust &amp; safety, or
          design, we&apos;d still like to hear from you. Send a short introduction and, if you like,
          a CV or portfolio to{" "}
          <a className="text-foreground underline" href="mailto:info@tirvea.com">
            info@tirvea.com
          </a>{" "}
          with &quot;Careers&quot; in the subject. We keep thoughtful introductions on file and reach
          out if something opens up.
        </p>
      </Section>

      <Section id="how-hiring-works" title="How hiring works">
        <p>When we do hire, we aim to keep the process clear and respectful of your time:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>An open role is posted on this page with what it involves.</li>
          <li>You apply by email with a short introduction and any relevant work.</li>
          <li>We review applications and reply to candidates we&apos;d like to talk to.</li>
          <li>Interviews focus on real problems relevant to the role.</li>
        </ul>
      </Section>

      <Section id="equal-opportunity" title="Equal opportunity">
        <p>
          WiseWave Limited is an equal-opportunity employer. We consider all applicants without
          regard to age, gender, gender identity or expression, sexual orientation, race,
          nationality, religion or belief, disability, or any other characteristic protected by
          applicable law. If you need an adjustment to take part in our process, let us know.
        </p>
      </Section>

      <Section id="recruitment-privacy" title="Recruitment privacy">
        <p>
          When you contact us about a role, WiseWave Limited processes the personal data you send
          (such as your name, contact details, CV, and any information in your message) only to
          consider you for current or future opportunities. We keep it for no longer than necessary
          for that purpose and do not use it for anything else. You can ask us to update or delete
          your details at any time. For how we handle personal data generally, see our{" "}
          <Link href="/legal/privacy" className="text-foreground underline">
            Privacy Policy
          </Link>
          .
        </p>
      </Section>
    </main>
  );
}
