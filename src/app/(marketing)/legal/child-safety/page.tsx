import type { Metadata } from "next";

export const metadata: Metadata = { title: "Child Safety Policy" };

export default function ChildSafetyPage() {
  return (
    <>
      <h1>Child Safety Policy</h1>
      <p>Last updated: 17 July 2026</p>

      <h2>1. 18+ only</h2>
      <p>
        Tirvea is strictly for adults aged 18 and over. We do not knowingly permit anyone under 18 to
        create an account or use the service. Age is confirmed at sign-up and reinforced by our
        verification layers.
      </p>

      <h2>2. Zero tolerance for child sexual abuse material (CSAM)</h2>
      <p>
        We have zero tolerance for content or conduct that sexualises minors. Any such content is
        removed, the account is terminated, and we report to the relevant authorities and hotlines
        (including, where applicable, national law-enforcement and child-protection bodies) as
        required by law.
      </p>

      <h2>3. Detection and reporting</h2>
      <ul>
        <li>Automated and human moderation help detect prohibited content.</li>
        <li>
          Anyone can report suspected child endangerment from within the app or by emailing
          info@tirvea.com — reports are prioritised.
        </li>
        <li>We preserve relevant records and cooperate with lawful investigations.</li>
      </ul>

      <h2>4. Underage accounts</h2>
      <p>
        If we learn that an account belongs to someone under 18, we remove it and delete associated
        personal data in line with our <a href="/legal/data-retention">Data Retention Policy</a>,
        subject to legal-hold requirements.
      </p>

      <h2>5. Contact</h2>
      <p>
        Report urgent child-safety concerns to your local emergency services first, then notify us at
        info@tirvea.com.
      </p>
    </>
  );
}
