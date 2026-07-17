import type { Metadata } from "next";

export const metadata: Metadata = { title: "Identity Verification Policy" };

export default function IdentityVerificationPage() {
  return (
    <>
      <h1>Identity Verification Policy</h1>
      <p>Last updated: 17 July 2026</p>

      <h2>1. Purpose</h2>
      <p>
        Identity verification helps keep Tirvea a community of real, adult people. It reduces
        impersonation, fake profiles, and underage access. WiseWave Limited is the data controller
        for this processing.
      </p>

      <h2>2. How it works</h2>
      <p>
        Identity verification is performed by a specialist provider (Stripe Identity). You complete
        the check in a hosted flow. Tirvea receives only the outcome (verified / not verified) and an
        opaque provider reference — never your identity documents or selfie images.
      </p>

      <h2>3. What we store</h2>
      <ul>
        <li>The verification outcome and the date it changed.</li>
        <li>An opaque provider session reference for reconciliation.</li>
        <li>No copies of your ID document or verification images.</li>
      </ul>

      <h2>4. Legal basis</h2>
      <p>
        We rely on our legitimate interest in platform safety and fraud prevention, and on your
        consent where the check is optional. See our <a href="/legal/privacy">Privacy Policy</a>.
      </p>

      <h2>5. Outcomes</h2>
      <p>
        A successful check can unlock a verified badge and related features. A failed or cancelled
        check does not by itself remove your account; you can retry. Verification does not guarantee
        any person’s intentions — always follow our <a href="/safety">safety guidance</a>.
      </p>

      <h2>6. Your rights and contact</h2>
      <p>
        You can exercise your data rights as described in our Privacy Policy. Questions:
        privacy@tirvea.app or info@tirvea.com.
      </p>
    </>
  );
}
