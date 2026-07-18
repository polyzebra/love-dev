import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { buildLegalMetadata } from "@/lib/legal/seo";

// L4.2 - thin wrapper. All legal text lives in docs/L4.2-GDPR-RIGHTS-POLICY-DRAFT.md.
export function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata("gdpr");
}

export default function GdprPage() {
  return <LegalDocument slug="gdpr" />;
}
