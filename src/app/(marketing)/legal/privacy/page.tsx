import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p>Last updated: 1 July 2026</p>

      <h2>Data controller</h2>
      <p>
        Tirvea is a platform operated by <strong>WiseWave Limited</strong>, which is the data
        controller responsible for your personal data under the EU General Data Protection
        Regulation (GDPR) and the Irish Data Protection Act 2018. WiseWave Limited is a company
        registered in Ireland (company number 762171), with its registered office at 39 Cooley Park,
        Dundalk, Co. Louth, A91 AP2V, Ireland. For any privacy question or to exercise your rights,
        contact us at info@tirvea.com (or privacy@tirvea.app for data-rights requests).
      </p>

      <h2>1. Data we collect</h2>
      <ul>
        <li>Account data: email, name, date of birth, hashed password.</li>
        <li>Profile data: photos, bio, preferences, interests, coarse location.</li>
        <li>Usage data: likes, matches, messages, device and session information.</li>
        <li>Billing data: handled by our payment providers; we never store card numbers.</li>
      </ul>

      <h2>2. How we use it</h2>
      <p>
        To provide matching and messaging, keep the community safe (moderation, anti-spam,
        anti-fraud), process payments, and improve the product. We do not sell personal data.
      </p>

      <h2>3. Legal bases (GDPR)</h2>
      <p>
        Contract performance for core features; legitimate interest for safety and product
        improvement; consent for marketing and optional verification.
      </p>

      <h2>4. Identity verification</h2>
      <p>
        Optional ID checks are performed by specialist providers. We receive only the verification
        outcome and a provider reference - never your documents.
      </p>

      <h2>5. Retention</h2>
      <p>
        Account data is kept while your account is active. When you delete your account, personal
        data is erased within 30 days, except records we must keep for legal compliance.
      </p>

      <h2>6. Your rights</h2>
      <ul>
        <li>Access & portability: export your data from Settings at any time.</li>
        <li>Erasure: delete your account from Settings - no emails, no phone calls required.</li>
        <li>Rectification, restriction and objection: contact privacy@tirvea.app.</li>
        <li>You may lodge a complaint with the Irish Data Protection Commission or the UK ICO.</li>
      </ul>

      <h2>7. International transfers</h2>
      <p>
        Data is hosted in the EU. Where processors operate outside the EEA/UK, transfers are
        protected by Standard Contractual Clauses.
      </p>

      <h2>8. Contact</h2>
      <p>Data Protection Officer: privacy@tirvea.app</p>
    </>
  );
}
