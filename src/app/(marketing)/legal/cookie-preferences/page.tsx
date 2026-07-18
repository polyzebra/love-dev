import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { buildLegalMetadata } from "@/lib/legal/seo";

// L4.4 - thin wrapper. All legal text lives in docs/L4.4-COOKIE-PREFERENCES-POLICY-DRAFT.md.
export function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata("cookie-preferences");
}

export default function CookiePreferencesPage() {
  return <LegalDocument slug="cookie-preferences" />;
}
