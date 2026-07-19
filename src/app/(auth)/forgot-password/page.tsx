import { redirect } from "next/navigation";

// P1.2 - Tirvea is passwordless (email/phone OTP + OAuth). There is no
// password sign-in, so a password-reset flow is unreachable and misleading.
// This route is retired into the supported account-recovery flow.
export default function ForgotPasswordPage() {
  redirect("/auth/recovery");
}
