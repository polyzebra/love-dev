import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Photo verification & face check",
  description:
    "How Tirvea confirms your profile photos are really you - separately from identity verification, with a video selfie, in the EU, and without storing your face data.",
};

// Content describes the IMPLEMENTED system (docs/FACE-VERIFICATION.md +
// FACE-REFERENCE-AUDIT.md). Items marked [PLACEHOLDER - legal review]
// stay until counsel signs off; production stays blocked until then.
export default function FaceCheckPage() {
  return (
    <article className="prose prose-neutral dark:prose-invert mx-auto max-w-2xl px-4 py-12">
      <h1>Photo verification, explained</h1>

      <p>
        Tirvea runs <strong>two separate checks</strong>, and they mean different things:
      </p>
      <ul>
        <li>
          <strong>Identity verification</strong> confirms you are a real person holding a genuine
          government document, using our partner Stripe. It is optional and adds a distinct badge.
        </li>
        <li>
          <strong>Photo verification</strong> confirms that the photos on your profile are actually
          of you. It does <em>not</em> check a government document. A &ldquo;Photo verified&rdquo;
          badge never means we verified your ID.
        </li>
      </ul>

      <h2>Why a video selfie?</h2>
      <p>
        To confirm your photos are you, we need a trusted picture of you to compare them against. We
        create it from a short <strong>video selfie liveness check</strong> - a video, not a still,
        because a video is far harder to fake with a printed photo or a screen. We never build that
        reference from your existing profile photos (that would let someone verify stolen pictures).
      </p>

      <h2>What data is processed</h2>
      <ul>
        <li>A short video selfie, captured and analysed by our verification partner in the EU.</li>
        <li>
          A vendor-side <strong>face reference</strong> is created from that selfie. Tirvea stores
          only an opaque handle to it - never your face geometry, template or images.
        </li>
        <li>Your profile photos are compared to that reference to produce a simple result.</li>
      </ul>

      <h2>Do we run duplicate-account checks?</h2>
      <p>
        Where enabled and legally approved, we may compare face references to detect one person
        running multiple verified accounts or impersonating someone. Only a clear impersonation
        match can affect your badge automatically; everything else is reviewed by a person.
        [PLACEHOLDER - legal review of duplicate search scope]
      </p>

      <h2>Retention &amp; deletion</h2>
      <ul>
        <li>
          The video and any capture frames are held only briefly by the provider, then deleted.
        </li>
        <li>
          The face reference is kept while your verification is valid and rotated periodically.
        </li>
        <li>
          Deleting your account, or withdrawing consent, destroys the reference at the provider.
          [PLACEHOLDER - final retention periods pending DPIA sign-off]
        </li>
      </ul>

      <h2>Consent, withdrawal, appeals &amp; restoration</h2>
      <p>
        The check is optional and needs your explicit consent. You can withdraw consent and delete
        your face data any time from Settings. If a check goes against you, you can appeal and a
        person will review it. If you return to Tirvea later, verification starts fresh.
      </p>

      <h2>Providers &amp; region</h2>
      <p>
        Identity verification: Stripe. Photo verification: a face-comparison provider processing in
        the EU. Availability may be limited by country during rollout.
      </p>

      <p>
        Full detail: <Link href="/legal/biometric-data">Biometric data notice</Link> ·{" "}
        <Link href="/help/photo-verification">Help &amp; troubleshooting</Link>. Questions:
        support@tirvea.com.
      </p>
    </article>
  );
}
