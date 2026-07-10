import type { Metadata } from "next";
import { phoneLoginEnabled } from "@/lib/auth/phone";
import { RecoveryOptions } from "@/components/auth/RecoveryOptions";

export const metadata: Metadata = {
  title: "Trouble signing in? - Tirvea",
};

// PHONE_LOGIN_ENABLED is RUNTIME env - never bake it in at build time.
export const dynamic = "force-dynamic";

/**
 * Account recovery, account-blind by design: it lists the doors (email
 * code, Google, phone when the flag is on) without ever revealing which
 * ones exist for any particular account.
 */
export default function RecoveryPage() {
  return <RecoveryOptions phoneEnabled={phoneLoginEnabled()} />;
}
