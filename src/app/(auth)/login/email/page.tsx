import type { Metadata } from "next";
import { EmailInputStep } from "@/components/auth/EmailInputStep";

export const metadata: Metadata = {
  title: "Sign in with email - Tirvea",
  description: "Sign in or create your Tirvea account with just your email.",
};

/**
 * /login/email - step 1 of the email journey (moved here from /auth,
 * which now 308s to /login). The code screen lives at /login/email/verify.
 */
export default function LoginEmailPage() {
  return <EmailInputStep />;
}
