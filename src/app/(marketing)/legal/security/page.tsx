import type { Metadata } from "next";

export const metadata: Metadata = { title: "Security" };

export default function SecurityPage() {
  return (
    <>
      <h1>Security</h1>
      <p>Last updated: 17 July 2026</p>

      <p>
        WiseWave Limited takes the security of the Tirvea platform seriously. This page summarises our
        approach; it is not a warranty.
      </p>

      <h2>Our practices</h2>
      <ul>
        <li>Encryption in transit (TLS) for all traffic, and encryption at rest for stored data.</li>
        <li>
          Authentication is handled by a specialist identity provider; we do not store plaintext
          passwords.
        </li>
        <li>Least-privilege access controls and audited administrative actions.</li>
        <li>Payment card data is handled by our PCI-compliant payment provider, not stored by us.</li>
        <li>
          Verification is designed for data minimisation: we store opaque provider references, never
          identity documents or biometric images.
        </li>
        <li>Rate limiting, abuse detection, and monitoring with alerting on anomalies.</li>
        <li>Signed, verified webhooks and fail-closed handling of provider failures.</li>
      </ul>

      <h2>Reporting a problem</h2>
      <p>
        If you believe you have found a security vulnerability, please follow our{" "}
        <a href="/legal/vulnerability-disclosure">Vulnerability Disclosure Policy</a>. For account
        security concerns, contact info@tirvea.com.
      </p>
    </>
  );
}
