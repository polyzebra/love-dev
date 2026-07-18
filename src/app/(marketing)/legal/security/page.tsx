import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { buildLegalMetadata } from "@/lib/legal/seo";

// L7.1 - thin wrapper. All legal text lives in docs/L7.1-SECURITY-POLICY-DRAFT.md.
export function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata("security");
}

export default function SecurityPage() {
  return <LegalDocument slug="security" />;
}
