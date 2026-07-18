import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { buildLegalMetadata } from "@/lib/legal/seo";

// L2.7 — thin wrapper. All legal text lives in docs/L3.1-TRUST-AND-SAFETY-POLICY-DRAFT.md.
export function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata("trust-safety");
}

export default function TrustSafetyPage() {
  return <LegalDocument slug="trust-safety" />;
}
