import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { buildLegalMetadata } from "@/lib/legal/seo";

// L7.3 - thin wrapper. All legal text lives in docs/L7.3-LAW-ENFORCEMENT-GUIDELINES-DRAFT.md.
export function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata("law-enforcement");
}

export default function LawEnforcementPage() {
  return <LegalDocument slug="law-enforcement" />;
}
