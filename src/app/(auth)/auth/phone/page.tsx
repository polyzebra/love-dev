import type { Metadata } from "next";
import { workflowCountries } from "@/lib/auth/phone-countries";
import { PhoneInputStep } from "@/components/auth/PhoneInputStep";

export const metadata: Metadata = {
  title: "Verify your number - Tirvea",
};

// The allowlist is RUNTIME env - never bake it in at build time.
export const dynamic = "force-dynamic";

/**
 * The authenticated phone verification / change step. Server component
 * so the country allowlist is read HERE (server env only) and handed to
 * the client as a prop - same pattern as /login/phone. This page's flow
 * is phone-flow.ts, which enforces workflowCountries("change") (the
 * onboarding verification step and the settings-driven change share that
 * one flow - see phone-countries.ts for the workflow -> call-site
 * mapping), so the picker renders exactly the list the server accepts.
 */
export default function PhonePage() {
  return <PhoneInputStep allowedIsos={workflowCountries("change")} />;
}
