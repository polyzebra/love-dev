import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { buildLegalMetadata } from "@/lib/legal/seo";

// L3.4 - thin wrapper. All legal text lives in docs/L3.4-CHILD-SAFETY-POLICY-DRAFT.md.
export function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata("child-safety");
}

export default function ChildSafetyPage() {
  return <LegalDocument slug="child-safety" />;
}
