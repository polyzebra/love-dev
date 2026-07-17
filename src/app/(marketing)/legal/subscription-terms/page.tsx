import type { Metadata } from "next";

export const metadata: Metadata = { title: "Subscription Terms" };

export default function SubscriptionTermsPage() {
  return (
    <>
      <h1>Subscription Terms</h1>
      <p>Last updated: 17 July 2026</p>

      <h2>1. Who provides the service</h2>
      <p>
        Paid subscriptions on Tirvea (including Tirvea Plus and Tirvea Gold) are provided by WiseWave
        Limited, a company registered in Ireland (company number 762171), registered office 39
        Cooley Park, Dundalk, Co. Louth, A91 AP2V, Ireland. Contact: info@tirvea.com.
      </p>

      <h2>2. Plans and pricing</h2>
      <p>
        Subscriptions are offered as recurring monthly plans. Prices are shown inclusive of
        applicable taxes at checkout in your local currency where available. The price and the
        features of each plan are displayed before you confirm your purchase.
      </p>

      <h2>3. Payment</h2>
      <p>
        Payments are processed by our payment provider, Stripe. We do not store your full card
        details. By subscribing you authorise us and our payment provider to charge your chosen
        payment method for the recurring subscription fee.
      </p>

      <h2>4. Automatic renewal</h2>
      <ul>
        <li>Your subscription renews automatically at the end of each billing period.</li>
        <li>You are charged the then-current price for your plan on each renewal date.</li>
        <li>We tell you in advance of any change to your recurring price.</li>
      </ul>

      <h2>5. Cancellation</h2>
      <p>
        You can cancel at any time from Settings → Subscription. Cancellation stops the next renewal;
        your paid features remain active until the end of the current billing period, after which
        your account returns to the free tier. We do not require you to call or email to cancel.
      </p>

      <h2>6. Cooling-off and digital content consent</h2>
      <p>
        Digital subscription services normally carry a 14-day right of withdrawal under EU consumer
        law. Where you ask us to begin providing the paid features immediately and acknowledge that
        you lose your 14-day withdrawal right once the service has been fully performed, that consent
        is captured at checkout. See our <a href="/legal/refund-policy">Refund Policy</a>.
      </p>

      <h2>7. Changes and termination</h2>
      <p>
        We may change plan features or pricing with reasonable notice. We may suspend or end a
        subscription where required by law or where an account breaches our{" "}
        <a href="/legal/terms">Terms of Service</a> or{" "}
        <a href="/legal/community-guidelines">Community Guidelines</a>.
      </p>

      <h2>8. Contact</h2>
      <p>Billing questions: info@tirvea.com.</p>
    </>
  );
}
