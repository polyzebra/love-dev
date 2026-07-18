import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { buildLegalMetadata } from "@/lib/legal/seo";

// L2.7 - thin wrapper. All legal text lives in docs/L2.3-PRIVACY-POLICY-DRAFT.md.
export function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata("privacy");
}

export default function PrivacyPage() {
  return <LegalDocument slug="privacy" />;
}
