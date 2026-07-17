import type { Metadata } from "next";

export const metadata: Metadata = { title: "Data Retention Policy" };

export default function DataRetentionPage() {
  return (
    <>
      <h1>Data Retention Policy</h1>
      <p>Last updated: 17 July 2026</p>

      <p>
        WiseWave Limited keeps personal data only for as long as it is needed for the purposes it was
        collected, or as required by law. This policy summarises our retention approach; read it with
        our <a href="/legal/privacy">Privacy Policy</a>.
      </p>

      <h2>Retention at a glance</h2>
      <ul>
        <li>
          <strong>Account &amp; profile data:</strong> kept while your account is active.
        </li>
        <li>
          <strong>After deletion:</strong> personal data is erased within 30 days, except records we
          must keep for legal, tax, or safety reasons.
        </li>
        <li>
          <strong>Messages:</strong> retained while the account is active; removed on account
          deletion subject to safety/legal holds.
        </li>
        <li>
          <strong>Verification data:</strong> only outcomes and opaque provider references — no
          documents or biometric images. Biometric references are deleted on consent withdrawal or
          account deletion (see the{" "}
          <a href="/legal/biometric-data">Biometric Information Policy</a>).
        </li>
        <li>
          <strong>Safety &amp; moderation records:</strong> retained as needed to enforce our rules,
          handle appeals, and comply with legal obligations.
        </li>
        <li>
          <strong>Billing records:</strong> retained as required by tax and accounting law.
        </li>
        <li>
          <strong>Security logs:</strong> retained for a limited period for fraud prevention and
          incident response.
        </li>
      </ul>

      <h2>Deletion</h2>
      <p>
        You can delete your account from Settings at any time. Some records may be retained in
        anonymised or aggregated form, or where a legal obligation requires it. Questions:
        privacy@tirvea.app.
      </p>
    </>
  );
}
