import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cookie Policy" };

export default function CookiePolicyPage() {
  return (
    <>
      <h1>Cookie Policy</h1>
      <p>Last updated: 17 July 2026</p>

      <h2>1. Who we are</h2>
      <p>
        This Cookie Policy explains how WiseWave Limited (company number 762171, registered in
        Ireland) uses cookies and similar technologies on the Tirvea platform. It should be read with
        our <a href="/legal/privacy">Privacy Policy</a>.
      </p>

      <h2>2. What cookies we use</h2>
      <ul>
        <li>
          <strong>Strictly necessary:</strong> sign-in sessions, security, and load balancing. These
          are required for the service to work and cannot be switched off.
        </li>
        <li>
          <strong>Functional:</strong> remembering preferences such as theme.
        </li>
        <li>
          <strong>Analytics (optional):</strong> aggregate, privacy-respecting usage measurement to
          improve the product. Set only with your consent where required.
        </li>
      </ul>

      <h2>3. Third parties</h2>
      <p>
        Some cookies are set by providers who help us run the service (for example authentication and
        payments). We do not use cookies to sell your personal data.
      </p>

      <h2>4. Managing cookies</h2>
      <p>
        Where consent is required for non-essential cookies, you can accept or decline them and change
        your choice at any time. You can also control cookies through your browser settings; blocking
        strictly-necessary cookies may stop parts of the service from working.
      </p>

      <h2>5. Contact</h2>
      <p>Questions: privacy@tirvea.app or info@tirvea.com.</p>
    </>
  );
}
