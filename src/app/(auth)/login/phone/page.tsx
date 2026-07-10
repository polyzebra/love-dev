import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { phoneLoginEnabled } from "@/lib/auth/phone";
import { getSupportedPhoneCountries } from "@/lib/auth/phone-countries";
import { PhoneLoginInput } from "@/components/auth/PhoneLoginInput";

export const metadata: Metadata = {
  title: "Continue with your phone - Tirvea",
};

// The flag/allowlist are RUNTIME env - never bake them in at build time.
export const dynamic = "force-dynamic";

/**
 * Phone LOGIN, step 1: the number. Server component so the flag and the
 * getSupportedPhoneCountries("login") list are read HERE (server env
 * only) - the same call phone-login-flow.ts validates against, so the
 * picker and the server can never disagree. With the flag off the page
 * doesn't exist for visitors, matching the hidden entry button (the API
 * would only answer 503 anyway).
 */
export default function PhoneLoginPage() {
  if (!phoneLoginEnabled()) redirect("/login");
  return <PhoneLoginInput allowedIsos={getSupportedPhoneCountries("login")} />;
}
