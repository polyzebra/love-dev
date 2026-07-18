import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { buildLegalMetadata } from "@/lib/legal/seo";

// L2.7 - thin wrapper. All legal text lives in docs/L2.2-TERMS-OF-SERVICE-DRAFT.md.
export function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata("terms");
}

export default function TermsPage() {
  return <LegalDocument slug="terms" />;
}
