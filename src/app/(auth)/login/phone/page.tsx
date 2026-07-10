import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { phoneLoginEnabled, phoneLoginCountries } from "@/lib/auth/phone";
import { PhoneLoginInput } from "@/components/auth/PhoneLoginInput";

export const metadata: Metadata = {
  title: "Continue with your phone - Tirvea",
};

// The flag/allowlist are RUNTIME env - never bake them in at build time.
export const dynamic = "force-dynamic";

/**
 * Phone LOGIN, step 1: the number. Server component so the flag and the
 * PHONE_LOGIN_COUNTRIES allowlist are read HERE (server env only) - with
 * the flag off the page doesn't exist for visitors, matching the hidden
 * entry button (the API would only answer 503 anyway).
 */
export default function PhoneLoginPage() {
  if (!phoneLoginEnabled()) redirect("/login");
  return <PhoneLoginInput allowedIsos={[...phoneLoginCountries()]} />;
}
