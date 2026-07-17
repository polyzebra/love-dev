import type { Metadata } from "next";

export const metadata: Metadata = { title: "Compliance Statement" };

export default function CompliancePage() {
  return (
    <>
      <h1>Compliance Statement</h1>
      <p>Last updated: 17 July 2026</p>

      <h2>1. Operating entity</h2>
      <p>
        Tirvea is a platform operated by WiseWave Limited, a company registered in Ireland (company
        number 762171), registered office 39 Cooley Park, Dundalk, Co. Louth, A91 AP2V, Ireland.
        Contact: info@tirvea.com.
      </p>

      <h2>2. Data protection (GDPR)</h2>
      <p>
        WiseWave Limited acts as the data controller for personal data processed on Tirvea and
        processes it in accordance with the EU General Data Protection Regulation and the Irish Data
        Protection Act 2018. Where providers process data on our behalf, we put appropriate data
        processing agreements in place. See our <a href="/legal/privacy">Privacy Policy</a>.
      </p>

      <h2>3. Consumer protection</h2>
      <p>
        Our paid plans are provided in line with EU/Irish consumer-protection law, including rules on
        automatic renewal, cancellation, and the right of withdrawal. See our{" "}
        <a href="/legal/subscription-terms">Subscription Terms</a> and{" "}
        <a href="/legal/refund-policy">Refund Policy</a>.
      </p>

      <h2>4. Digital services and safety</h2>
      <p>
        We operate transparent content moderation, notice-and-action, statement-of-reasons, and
        appeal processes. Our specific obligations under digital-services regulation depend on our
        legal classification and size. See our <a href="/legal/transparency">Transparency</a> page.
      </p>

      <h2>5. Trust &amp; safety</h2>
      <p>
        We enforce strict 18+ access, zero tolerance for child sexual abuse material, and cooperate
        with lawful requests. See our <a href="/legal/child-safety">Child Safety Policy</a> and{" "}
        <a href="/legal/law-enforcement">Law Enforcement Guidelines</a>.
      </p>

      <h2>6. Supervisory authority</h2>
      <p>
        You may contact the Irish Data Protection Commission regarding our handling of personal data.
      </p>
    </>
  );
}
