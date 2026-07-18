import type { Metadata } from "next";

export const metadata: Metadata = { title: "Refund Policy" };

export default function RefundPolicyPage() {
  return (
    <>
      <h1>Refund Policy</h1>
      <p>Last updated: 17 July 2026</p>

      <h2>1. Your statutory right of withdrawal (EU/EEA)</h2>
      <p>
        If you are a consumer in the EU/EEA, you generally have 14 days to withdraw from a purchase
        of digital services without giving a reason. This period starts on the day you subscribe.
      </p>

      <h2>2. Immediate access and the effect on withdrawal</h2>
      <p>
        Because a Tirvea subscription gives you immediate access to paid features, at checkout you
        may ask us to start the service straight away and acknowledge that, once the service has been
        fully performed, your 14-day withdrawal right no longer applies. Where the service has only
        partially been performed within the 14 days, any refund is reduced in proportion to what has
        already been provided.
      </p>

      <h2>3. Cancellation vs refund</h2>
      <ul>
        <li>Cancelling stops future renewals; it is not itself a refund.</li>
        <li>
          Within a valid withdrawal window, contact info@tirvea.com and we will process any refund
          due to your original payment method.
        </li>
        <li>
          Outside the withdrawal window, subscription fees for the current period are generally
          non-refundable, except where required by law.
        </li>
      </ul>

      <h2>4. Exceptional refunds</h2>
      <p>
        We may issue a refund at our discretion - for example, a duplicate charge or a proven billing
        error. Refunds are returned to the original payment method via our payment provider.
      </p>

      <h2>5. How to request</h2>
      <p>
        Email info@tirvea.com with your account email and the charge date. We aim to respond within a
        few business days. Nothing here limits your rights under Irish or EU consumer law.
      </p>
    </>
  );
}
