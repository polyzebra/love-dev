import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { buildLegalMetadata } from "@/lib/legal/seo";

// L2.7 - thin wrapper. All legal text lives in docs/L2.1-COPYRIGHT-POLICY-DRAFT.md.
export function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata("copyright");
}

export default function CopyrightPage() {
  return <LegalDocument slug="copyright" />;
}
