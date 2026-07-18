import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { buildLegalMetadata } from "@/lib/legal/seo";

// L6.2 - thin wrapper. All legal text lives in docs/L6.2-REFUND-POLICY-DRAFT.md.
export function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata("refund-policy");
}

export default function RefundPolicyPage() {
  return <LegalDocument slug="refund-policy" />;
}
