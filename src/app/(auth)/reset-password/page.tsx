import { redirect } from "next/navigation";

// P1.2 - Tirvea is passwordless (email/phone OTP + OAuth). Setting a password
// has no effect on sign-in, so this route is retired into the supported
// account-recovery flow.
export default function ResetPasswordPage() {
  redirect("/auth/recovery");
}
