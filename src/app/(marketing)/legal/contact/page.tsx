import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Legal & Compliance" };

// L4.3 - Legal & Compliance routing directory. Every destination routes to a
// page that already exists; no invented routes, emails, or response-time SLAs.
// Renders inside the Legal Centre reading shell (LegalChrome), so the heading
// and prose inherit the documentation typography.
export default function LegalCompliancePage() {
  return (
    <>
      <h1>Legal &amp; Compliance</h1>
      <p>
        Tirvea is operated by WiseWave Limited. This page directs legal, privacy, security, and
        compliance enquiries to the right place. For account help, see the{" "}
        <Link href="/help">Help Centre</Link>; to send us a message, use the{" "}
        <Link href="/contact">contact form</Link>.
      </p>

      <h2>General legal &amp; compliance</h2>
      <p>
        For general legal and compliance enquiries, email{" "}
        <a href="mailto:info@tirvea.com">info@tirvea.com</a>. Our regulatory framework is summarised
        in the <Link href="/legal/compliance">Compliance Statement</Link>. Official company details
        are at the foot of this page.
      </p>

      <h2>Privacy &amp; data requests (GDPR)</h2>
      <p>
        To exercise your data-protection rights - access, portability (export), rectification,
        erasure, restriction, or objection - see <Link href="/legal/gdpr">Your data rights</Link>{" "}
        and the <Link href="/legal/privacy">Privacy Policy</Link>. To submit a request, use the{" "}
        <Link href="/contact">contact form</Link>{" "}and choose &quot;Privacy or data request&quot;.
        Retention periods are in the <Link href="/legal/data-retention">Data Retention Policy</Link>,
        and account deletion in the{" "}
        <Link href="/legal/account-deletion">Account Deletion Policy</Link>.
      </p>

      <h2>Copyright &amp; trademark</h2>
      <p>
        To report copyright infringement, see the{" "}
        <Link href="/legal/copyright">Copyright Policy</Link>. For brand, logo, and trademark use,
        see the brand guidelines on the <Link href="/press">Press page</Link>.
      </p>

      <h2>Law enforcement &amp; court orders</h2>
      <p>
        Authorities making a lawful request for user data should follow the{" "}
        <Link href="/legal/law-enforcement">Law Enforcement Guidelines</Link>, which set out how we
        handle preservation, disclosure, court orders, and emergency requests.
      </p>

      <h2>Security &amp; vulnerability disclosure</h2>
      <p>
        To report a security vulnerability, follow the{" "}
        <Link href="/legal/vulnerability-disclosure">Vulnerability Disclosure Policy</Link>. Our
        security practices are described in the <Link href="/legal/security">Security Policy</Link>.
      </p>

      <h2>Media &amp; business</h2>
      <p>
        For press and media enquiries, see the <Link href="/press">Press page</Link>. For business
        or partnership enquiries, use the <Link href="/contact">contact form</Link>{" "}and choose{" "}
        &quot;Business enquiry&quot;.
      </p>

      <h2>Official company information</h2>
      <ul>
        <li>WiseWave Limited (Company Number 762171)</li>
        <li>Registered office: 39 Cooley Park, Dundalk, Co. Louth, A91 AP2V, Ireland</li>
        <li>
          Email: <a href="mailto:info@tirvea.com">info@tirvea.com</a>
        </li>
        <li>
          Governing law: Ireland - see the <Link href="/legal/terms">Terms of Service</Link>.
        </li>
      </ul>
    </>
  );
}
