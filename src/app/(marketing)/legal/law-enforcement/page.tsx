import type { Metadata } from "next";

export const metadata: Metadata = { title: "Law Enforcement Guidelines" };

export default function LawEnforcementPage() {
  return (
    <>
      <h1>Law Enforcement Guidelines</h1>
      <p>Last updated: 17 July 2026</p>

      <p>
        These guidelines are for law-enforcement authorities seeking information from WiseWave Limited
        in relation to the Tirvea platform. They are informational and do not waive any right or
        create any obligation.
      </p>

      <h2>1. Legal process</h2>
      <p>
        WiseWave Limited is established in Ireland. We disclose user data only where we are legally
        required or permitted to do so, in response to valid legal process appropriate to our
        jurisdiction (for example a court order or a request under an applicable mutual legal
        assistance framework).
      </p>

      <h2>2. How to submit a request</h2>
      <ul>
        <li>
          Send requests on official letterhead to info@tirvea.com, identifying the legal basis, the
          specific data sought, and the account (email or user identifier).
        </li>
        <li>Requests should be narrowly scoped and proportionate.</li>
        <li>We may seek clarification or challenge overbroad or unlawful requests.</li>
      </ul>

      <h2>3. Emergency requests</h2>
      <p>
        Where there is a risk of imminent death or serious physical harm, mark the request as an
        emergency. We may voluntarily disclose limited information to help prevent that harm, in line
        with applicable law.
      </p>

      <h2>4. Data preservation</h2>
      <p>
        We can act on a valid preservation request to retain specified records pending lawful process.
      </p>

      <h2>5. What we hold</h2>
      <p>
        We do not store identity documents or biometric images; verification data is limited to
        outcomes and opaque provider references. See our{" "}
        <a href="/legal/privacy">Privacy Policy</a> and{" "}
        <a href="/legal/data-retention">Data Retention Policy</a>.
      </p>

      <h2>6. User notice</h2>
      <p>
        We may notify users of a request for their data unless prohibited by law or where notice would
        be counterproductive in an emergency.
      </p>
    </>
  );
}
