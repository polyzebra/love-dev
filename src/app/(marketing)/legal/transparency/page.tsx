import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { buildLegalMetadata } from "@/lib/legal/seo";

// L7.4 - thin wrapper. All legal text lives in docs/L7.4-TRANSPARENCY-REPORT-POLICY-DRAFT.md.
export function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata("transparency");
}

export default function TransparencyPage() {
  return <LegalDocument slug="transparency" />;
}
