import { Suspense } from "react";
import { AuthStepFallback } from "@/components/auth/AuthStepFallback";
import type { Metadata } from "next";
import { EmailCodeStep } from "@/components/auth/EmailCodeStep";

export const metadata: Metadata = {
  title: "Enter your code - Tirvea",
};

/**
 * /login/email/verify - the emailed 6-digit code (moved here from
 * /auth/email-code, which now 308s over with the email param intact).
 */
export default function LoginEmailVerifyPage() {
  // Suspense boundary for useSearchParams (the ?email=... carrier).
  return (
    <Suspense fallback={<AuthStepFallback />}>
      <EmailCodeStep />
    </Suspense>
  );
}
