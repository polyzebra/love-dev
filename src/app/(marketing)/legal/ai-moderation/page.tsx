import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { buildLegalMetadata } from "@/lib/legal/seo";

// L3.5 - thin wrapper. All legal text lives in docs/L3.5-AI-MODERATION-POLICY-DRAFT.md.
export function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata("ai-moderation");
}

export default function AiModerationPage() {
  return <LegalDocument slug="ai-moderation" />;
}
