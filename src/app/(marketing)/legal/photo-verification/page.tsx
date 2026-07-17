import type { Metadata } from "next";

export const metadata: Metadata = { title: "Photo Verification Policy" };

export default function PhotoVerificationPage() {
  return (
    <>
      <h1>Photo Verification Policy</h1>
      <p>Last updated: 17 July 2026</p>

      <h2>1. What photo verification is</h2>
      <p>
        Photo verification confirms that the profile photos belong to the identity-verified person
        behind the account. It is a separate, optional layer from identity verification. WiseWave
        Limited is the data controller.
      </p>

      <h2>2. How it works</h2>
      <p>
        With your consent, you complete a brief liveness check to prove you are a real, live person.
        A reference derived from that check is compared against your profile photos to confirm they
        show the same person. This layer is powered by a specialist provider (AWS Rekognition) and is
        governed by our <a href="/legal/biometric-data">Biometric Information Policy</a>.
      </p>

      <h2>3. What we store</h2>
      <ul>
        <li>An opaque provider reference (never your images or biometric templates).</li>
        <li>The verification outcome, thresholds version, and audit metadata.</li>
        <li>No copies of liveness video or profile-photo comparison images.</li>
      </ul>

      <h2>4. Anti-spoofing</h2>
      <p>
        Presenting a printed photo, a screen, a recording, or another person to defeat the check is a
        breach of our <a href="/legal/acceptable-use">Acceptable Use Policy</a> and may lead to
        enforcement action.
      </p>

      <h2>5. Withdrawal</h2>
      <p>
        You can withdraw consent at any time; we then stop the comparison and delete the associated
        biometric reference at the provider. Your identity verification and account are unaffected.
        See the <a href="/legal/biometric-data">Biometric Information Policy</a>.
      </p>
    </>
  );
}
