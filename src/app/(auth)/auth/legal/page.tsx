import type { Metadata } from "next";
import { LegalConsentStep } from "@/components/auth/LegalConsentStep";

export const metadata: Metadata = {
  title: "Ground rules - Tirvea",
};

export default function LegalPage() {
  return <LegalConsentStep />;
}
