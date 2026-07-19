import type { Metadata } from "next";
import { PageShell } from "@/components/layout/public";
import Link from "next/link";
import { ContactForm } from "@/components/marketing/contact-form";
import { buildMarketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "Contact",
  description:
    "Contact Tirvea support. Send us a message and a person will reply by email. For emergencies, contact your local emergency services.",
  path: "/contact",
});

export default function ContactPage() {
  return (
    <PageShell width="reading">
      <h1 className="font-display text-4xl font-semibold tracking-tight">Contact us</h1>
      <p className="text-muted-foreground mt-4 max-w-2xl leading-relaxed">
        Send a message and a person will read it and reply by email. Choose the category that fits
        best so we can route it to the right place. You can also browse the{" "}
        <Link href="/help" className="text-foreground underline">
          Help Centre
        </Link>{" "}
        for immediate answers.
      </p>

      {/* Emergency notice - the ordinary form must never imply emergency handling. */}
      <div className="border-destructive/40 bg-destructive/10 mt-6 rounded-2xl border p-4">
        <p className="text-foreground text-sm leading-relaxed">
          <strong>In immediate danger?</strong> This form is not monitored for emergencies. If you
          or someone else is at risk of harm, call <strong>112</strong> or your local emergency
          number. To report a profile or message, use the report and block tools in the app or the{" "}
          <Link href="/safety" className="underline">
            Safety Centre
          </Link>
          .
        </p>
      </div>

      <div className="mt-8">
        <ContactForm />
      </div>

      <div className="border-border mt-12 space-y-3 border-t pt-8 text-sm leading-relaxed">
        <h2 className="text-foreground text-base font-semibold">Other ways to reach us</h2>
        <p className="text-muted-foreground">
          You can also email{" "}
          <a href="mailto:info@tirvea.com" className="text-foreground underline">
            info@tirvea.com
          </a>
          . For legal and privacy matters, see the{" "}
          <Link href="/legal" className="text-foreground underline">
            Legal Centre
          </Link>
          ; for security reports, the{" "}
          <Link href="/legal/vulnerability-disclosure" className="text-foreground underline">
            Vulnerability Disclosure Policy
          </Link>
          .
        </p>
        <p className="text-muted-foreground">
          Tirvea is operated by <strong>WiseWave Limited</strong>, a company registered in Ireland
          (company number 762171), registered office 39 Cooley Park, Dundalk, Co. Louth, A91 AP2V,
          Ireland. The registered office is not a customer walk-in or support location.
        </p>
      </div>
    </PageShell>
  );
}
