import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { buildLegalMetadata } from "@/lib/legal/seo";

// L5.1 - thin wrapper. All legal text lives in docs/L5.1-BIOMETRIC-INFORMATION-POLICY-DRAFT.md.
export function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata("biometric-data");
}

export default function BiometricDataPage() {
  return <LegalDocument slug="biometric-data" />;
}
