import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Biometric data notice",
  description:
    "How Tirvea processes face data for photo verification: lawful basis, retention, deletion and your rights.",
};

// [PLACEHOLDER] markers denote choices requiring legal sign-off. Production
// biometric processing stays blocked (FACE_LEGAL_APPROVAL_VERSION unset)
// until these are resolved by counsel. See docs/DPIA-FACE-VERIFICATION.md.
export default function BiometricDataPage() {
  return (
    <article className="prose prose-neutral dark:prose-invert mx-auto max-w-2xl px-4 py-12">
      <h1>Biometric data notice</h1>
      <p className="text-muted-foreground">
        This notice explains how Tirvea processes facial data for the optional photo-verification
        feature. It is separate from identity verification (Stripe), which is covered in our{" "}
        <Link href="/legal/privacy">Privacy Policy</Link>.
      </p>

      <h2>What we process</h2>
      <p>
        With your explicit consent, a short video selfie is captured and analysed by our
        verification partner to create a face reference, which your profile photos are compared
        against. Facial geometry is <strong>special-category (biometric) data</strong> under GDPR
        Article 9.
      </p>

      <h2>Lawful basis</h2>
      <p>
        [PLACEHOLDER - lawful basis to be confirmed by counsel: explicit consent under Art. 9(2)(a)
        is the intended basis.] You may withdraw consent at any time without affecting the
        lawfulness of processing before withdrawal.
      </p>

      <h2>What Tirvea stores</h2>
      <ul>
        <li>
          An opaque reference handle held by our provider - <strong>never</strong> face geometry,
          templates or vectors at Tirvea.
        </li>
        <li>A simple result (verified / under review / not confirmed) and reason codes.</li>
        <li>
          No video, no images, no numeric similarity scores in Tirvea&apos;s systems, logs or
          analytics.
        </li>
      </ul>

      <h2>Processors &amp; international transfers</h2>
      <p>
        Processing takes place in the EU. Processors: our identity provider (Stripe) and our
        face-comparison provider. [PLACEHOLDER - subprocessor list &amp; transfer mechanism (SCCs /
        adequacy) to be finalised with the signed DPA.]
      </p>

      <h2>Retention &amp; deletion</h2>
      <p>
        Video and capture frames: held briefly by the provider then deleted. Face reference: kept
        while your verification is valid, rotated periodically, and destroyed when you delete your
        account or withdraw consent. [PLACEHOLDER - exact periods pending DPIA.]
      </p>

      <h2>Your rights</h2>
      <p>
        Access, rectification, erasure, restriction, objection and portability apply. To withdraw
        consent and delete your face data: Settings &rsaquo; Privacy &rsaquo; Delete face data.
        Contact: dpo@tirvea.com. You may complain to the Irish Data Protection Commission.
      </p>

      <p className="text-muted-foreground text-sm">
        Sections marked [PLACEHOLDER] are pending legal review. The feature is not enabled in
        production until that review is complete.
      </p>
    </article>
  );
}
