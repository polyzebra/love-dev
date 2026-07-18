import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { buildLegalMetadata } from "@/lib/legal/seo";

// L2.9 - thin wrapper. All legal text lives in docs/L3.2-APPEALS-POLICY-DRAFT.md.
export function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata("appeals");
}

export default function AppealsPage() {
  return <LegalDocument slug="appeals" />;
}
