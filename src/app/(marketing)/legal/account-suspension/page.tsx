import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { buildLegalMetadata } from "@/lib/legal/seo";

// L3.3 - thin wrapper. All legal text lives in docs/L3.3-ACCOUNT-SUSPENSION-POLICY-DRAFT.md.
export function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata("account-suspension");
}

export default function AccountSuspensionPage() {
  return <LegalDocument slug="account-suspension" />;
}
