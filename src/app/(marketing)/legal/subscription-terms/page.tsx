import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { buildLegalMetadata } from "@/lib/legal/seo";

// L6.1 - thin wrapper. All legal text lives in docs/L6.1-SUBSCRIPTION-TERMS-DRAFT.md.
export function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata("subscription-terms");
}

export default function SubscriptionTermsPage() {
  return <LegalDocument slug="subscription-terms" />;
}
