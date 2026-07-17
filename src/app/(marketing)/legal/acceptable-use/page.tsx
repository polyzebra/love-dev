import type { Metadata } from "next";

export const metadata: Metadata = { title: "Acceptable Use Policy" };

export default function AcceptableUsePage() {
  return (
    <>
      <h1>Acceptable Use Policy</h1>
      <p>Last updated: 17 July 2026</p>

      <p>
        This Acceptable Use Policy applies to everyone who uses Tirvea, a platform operated by
        WiseWave Limited. It supplements our <a href="/legal/terms">Terms of Service</a> and{" "}
        <a href="/legal/community-guidelines">Community Guidelines</a>.
      </p>

      <h2>1. You must not</h2>
      <ul>
        <li>Use Tirvea if you are under 18.</li>
        <li>Impersonate another person or misrepresent your identity, age, or photos.</li>
        <li>Harass, threaten, abuse, or stalk anyone, on or off the platform.</li>
        <li>Post sexual content involving minors, or any content that sexualises minors.</li>
        <li>Share non-consensual intimate imagery, or content that is violent or hateful.</li>
        <li>Solicit money, run scams, phishing, or spam other members.</li>
        <li>Sell, promote, or facilitate illegal goods or services, or human trafficking.</li>
        <li>Upload malware, scrape the service, or attempt to bypass security or rate limits.</li>
        <li>Use bots or automated accounts, or create multiple or fake accounts.</li>
      </ul>

      <h2>2. Verification and authenticity</h2>
      <p>
        You must not defeat or attempt to defeat our identity or photo-verification checks — for
        example by presenting a photo, screen, recording, or another person during a liveness check.
        See our <a href="/legal/identity-verification">Identity Verification</a> and{" "}
        <a href="/legal/photo-verification">Photo Verification</a> policies.
      </p>

      <h2>3. Enforcement</h2>
      <p>
        Breaking these rules can lead to content removal, warnings, feature limits, suspension, or
        permanent termination, and where appropriate reporting to the authorities. See our{" "}
        <a href="/safety">Safety Centre</a> for how to report and how appeals work.
      </p>

      <h2>4. Reporting</h2>
      <p>You can report a profile, message, or content from within the app, or email info@tirvea.com.</p>
    </>
  );
}
