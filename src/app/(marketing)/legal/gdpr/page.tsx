import type { Metadata } from "next";

export const metadata: Metadata = { title: "GDPR & Your Rights" };

export default function GdprPage() {
  return (
    <>
      <h1>GDPR & Your Rights</h1>
      <p>
        WiseWave Limited is the data controller for Tirvea. This page explains your rights under the
        EU and UK General Data Protection Regulation - access, rectification, erasure, portability,
        restriction, and objection - and how to exercise them. The full text is being finalised.
      </p>
      <p>
        For the detail of what we collect and why, see the Privacy Policy and Data Retention Policy.
        To make a request, contact us at info@tirvea.com.
      </p>
    </>
  );
}
