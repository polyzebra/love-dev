import type { Metadata } from "next";

export const metadata: Metadata = { title: "Transparency" };

export default function TransparencyPage() {
  return (
    <>
      <h1>Transparency</h1>
      <p>Last updated: 17 July 2026</p>

      <h2>1. Our commitment</h2>
      <p>
        WiseWave Limited is committed to transparent, fair content moderation on Tirvea. This page
        explains how we moderate, how you can challenge decisions, and how we report on our activity.
      </p>

      <h2>2. Content moderation</h2>
      <p>
        We combine automated tools and human review to enforce our{" "}
        <a href="/legal/community-guidelines">Community Guidelines</a> and{" "}
        <a href="/legal/acceptable-use">Acceptable Use Policy</a>. Automated tools help detect
        prohibited content; consequential decisions are subject to human oversight.
      </p>

      <h2>3. Notice and action</h2>
      <p>
        Anyone can report content or a profile from within the app. We assess reports and take
        proportionate action, which can include removal, feature limits, suspension, or termination.
      </p>

      <h2>4. Statement of reasons</h2>
      <p>
        When we restrict content or an account for a rules violation, we aim to tell the affected user
        what happened and why, and how to appeal, unless the law prevents us from doing so.
      </p>

      <h2>5. Appeals and complaints</h2>
      <p>
        You can appeal enforcement decisions through our in-product appeal flow. See the{" "}
        <a href="/safety">Safety Centre</a> for how appeals are handled and timelines.
      </p>

      <h2>6. Reporting</h2>
      <p>
        Where required by applicable digital-services regulation, we publish periodic transparency
        reports covering the volume of reports, actions taken, and appeals. Our specific obligations
        depend on our legal classification and size.
      </p>

      <h2>7. Contact</h2>
      <p>info@tirvea.com.</p>
    </>
  );
}
