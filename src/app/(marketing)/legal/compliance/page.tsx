import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { buildLegalMetadata } from "@/lib/legal/seo";

// L7.5 - thin wrapper. All legal text lives in docs/L7.5-COMPLIANCE-STATEMENT-DRAFT.md.
export function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata("compliance");
}

export default function CompliancePage() {
  return <LegalDocument slug="compliance" />;
}
