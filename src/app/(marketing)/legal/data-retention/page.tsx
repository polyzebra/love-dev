import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { buildLegalMetadata } from "@/lib/legal/seo";

// L4.1 - thin wrapper. All legal text lives in docs/L4.1-DATA-RETENTION-POLICY-DRAFT.md.
export function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata("data-retention");
}

export default function DataRetentionPage() {
  return <LegalDocument slug="data-retention" />;
}
