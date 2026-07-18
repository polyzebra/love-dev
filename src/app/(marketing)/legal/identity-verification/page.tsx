import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { buildLegalMetadata } from "@/lib/legal/seo";

// L5.3 - thin wrapper. All legal text lives in docs/L5.3-IDENTITY-VERIFICATION-POLICY-DRAFT.md.
export function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata("identity-verification");
}

export default function IdentityVerificationPage() {
  return <LegalDocument slug="identity-verification" />;
}
