import type { Metadata } from "next";

export const metadata: Metadata = { title: "AI Moderation Policy" };

export default function AiModerationPage() {
  return (
    <>
      <h1>AI Moderation Policy</h1>
      <p>Last updated: 17 July 2026</p>

      <h2>1. Why we use automated tools</h2>
      <p>
        To keep Tirvea safe at scale, WiseWave Limited uses automated systems to help detect content
        that may breach our <a href="/legal/community-guidelines">Community Guidelines</a> or{" "}
        <a href="/legal/acceptable-use">Acceptable Use Policy</a> — for example nudity, violence,
        spam, scams, or synthetic or manipulated media.
      </p>

      <h2>2. Human oversight</h2>
      <p>
        Automated tools assist human reviewers; they do not replace them for consequential
        decisions. Significant enforcement actions are subject to human review, and you can appeal.
      </p>

      <h2>3. What the tools assess</h2>
      <ul>
        <li>
          Uploaded photos are screened for policy-violating content before or shortly after posting.
        </li>
        <li>Signals such as duplicate-image and likeness checks support anti-impersonation.</li>
        <li>
          We do not use these tools to make solely-automated decisions with legal or similarly
          significant effects without a route to human review.
        </li>
      </ul>

      <h2>4. Accuracy and fairness</h2>
      <p>
        No automated system is perfect. We calibrate thresholds, monitor error rates, and provide an
        appeal path so mistakes can be corrected. See our{" "}
        <a href="/legal/transparency">Transparency</a> page.
      </p>

      <h2>5. Your rights</h2>
      <p>
        You can request human review of a moderation decision through our appeal flow and exercise
        your data rights as described in our <a href="/legal/privacy">Privacy Policy</a>.
      </p>
    </>
  );
}
