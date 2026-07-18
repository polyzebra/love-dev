import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { buildLegalMetadata } from "@/lib/legal/seo";

// L5.2 - thin wrapper. All legal text lives in docs/L5.2-PHOTO-VERIFICATION-POLICY-DRAFT.md.
export function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata("photo-verification");
}

export default function PhotoVerificationPage() {
  return <LegalDocument slug="photo-verification" />;
}
