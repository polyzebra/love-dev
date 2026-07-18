import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { buildLegalMetadata } from "@/lib/legal/seo";

// L4.3 - thin wrapper. All legal text lives in docs/L4.3-ACCOUNT-DELETION-POLICY-DRAFT.md.
export function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata("account-deletion");
}

export default function AccountDeletionPage() {
  return <LegalDocument slug="account-deletion" />;
}
