import type { Metadata } from "next";

export const metadata: Metadata = { title: "Community Guidelines" };

export default function CommunityGuidelinesPage() {
  return (
    <>
      <h1>Community Guidelines</h1>
      <p>
        Amora works because people feel safe being themselves. These guidelines apply to profiles,
        photos, messages and behaviour — on and off the platform.
      </p>

      <h2>Be yourself, genuinely</h2>
      <ul>
        <li>Use recent photos that clearly show you.</li>
        <li>No impersonation, no fake ages, no misleading profiles.</li>
        <li>Accounts are for individuals — no couples accounts, businesses or promotion.</li>
      </ul>

      <h2>Respect is non-negotiable</h2>
      <ul>
        <li>No harassment, hate speech, or discrimination of any kind.</li>
        <li>No unsolicited sexual content. Consent applies to conversations too.</li>
        <li>A non-reply is an answer. Do not pressure people to respond.</li>
      </ul>

      <h2>Keep it legal and honest</h2>
      <ul>
        <li>No scams, financial requests, or link-outs to paid services.</li>
        <li>No drugs marketplace activity, weapons, or illegal content.</li>
        <li>Anyone under 18 is removed immediately and permanently.</li>
      </ul>

      <h2>Enforcement</h2>
      <p>
        Violations lead to warnings, feature limits, or permanent bans depending on severity.
        Serious harms — threats, exploitation, fraud — result in immediate removal and, where
        appropriate, referral to law enforcement.
      </p>

      <h2>Help us protect the community</h2>
      <p>
        Report anything that feels wrong. Every report is reviewed by a person, and reporting is
        always confidential.
      </p>
    </>
  );
}
