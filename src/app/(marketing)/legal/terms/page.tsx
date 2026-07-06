import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p>Last updated: 1 July 2026</p>

      <h2>1. Who we are</h2>
      <p>
        Virelsy is operated by Virelsy Ltd. These terms govern your use of the
        Virelsy platform across web and mobile.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        You must be at least 18 years old to create an account. By registering you confirm that the
        information you provide is accurate and that you are legally permitted to use the service in
        your country of residence.
      </p>

      <h2>3. Your account</h2>
      <ul>
        <li>You are responsible for keeping your credentials secure.</li>
        <li>One account per person; accounts are non-transferable.</li>
        <li>We may suspend accounts that breach our Community Guidelines.</li>
      </ul>

      <h2>4. Subscriptions & billing</h2>
      <p>
        Paid plans renew monthly until cancelled. You can cancel any time in Settings and retain
        access until the end of the billing period. Statutory cooling-off rights under EU and UK
        consumer law apply.
      </p>

      <h2>5. Acceptable use</h2>
      <p>
        You agree not to harass others, post unlawful content, impersonate anyone, use the platform
        commercially, or attempt to scrape or reverse-engineer the service.
      </p>

      <h2>6. Content</h2>
      <p>
        You retain ownership of the content you post and grant us a limited licence to display it
        within the service. We may remove content that violates our guidelines.
      </p>

      <h2>7. Liability</h2>
      <p>
        Virelsy provides a platform for meeting people; we do not conduct criminal background checks
        on members. Nothing in these terms excludes liability that cannot be excluded under Irish or
        UK law.
      </p>

      <h2>8. Contact</h2>
      <p>Questions about these terms: legal@virelsy.app</p>
    </>
  );
}
