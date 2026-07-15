import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Photo verification help",
  description:
    "Troubleshooting the video-selfie photo check: camera access, lighting, retries and results.",
};

export default function PhotoVerificationHelpPage() {
  return (
    <article className="prose prose-neutral dark:prose-invert mx-auto max-w-2xl px-4 py-12">
      <h1>Photo verification: help</h1>

      <h2>How it works</h2>
      <ol>
        <li>Verify your identity (if you haven&apos;t already).</li>
        <li>Agree to the photo check and record a short video selfie.</li>
        <li>We confirm your cover photo matches you, then check your other photos.</li>
        <li>Your verified badge appears - usually within a minute.</li>
      </ol>

      <h2>The camera won&apos;t start</h2>
      <p>
        Allow camera access for your browser. On iPhone: Settings &rsaquo; Safari &rsaquo; Camera.
        On Android: tap the padlock in the address bar &rsaquo; Permissions. Then tap Try again.
      </p>

      <h2>My check failed</h2>
      <p>
        Usually lighting or movement. Face a window, hold the phone at eye level, keep your whole
        face in the oval, and stay still. You can retry right away - retries never create duplicate
        sessions.
      </p>

      <h2>My cover photo was rejected</h2>
      <p>
        Your cover must clearly show your own face. Group shots, heavily filtered photos or photos
        of someone else can&apos;t be your cover. Pick a clear solo photo of yourself and the badge
        returns.
      </p>

      <h2>What Tirvea can and can&apos;t see</h2>
      <p>
        Staff see a simple result (verified / needs review) and reason codes - never your video,
        your face data, or any numeric scores.
      </p>

      <h2>Withdrawing consent</h2>
      <p>
        Settings &rsaquo; Privacy &rsaquo; Delete face data removes your reference at the provider
        and clears the badge. See the{" "}
        <Link href="/legal/biometric-data">Biometric data notice</Link>.
      </p>
    </article>
  );
}
