import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { authNextStep } from "@/lib/auth/gate";
import { phoneLoginEnabled } from "@/lib/auth/phone";
import { LoginEntry } from "@/components/auth/LoginEntry";

export const metadata: Metadata = {
  title: "Sign in - Tirvea",
  description: "Sign in or create your Tirvea account.",
};

/**
 * /login - the auth front door. Server component so availability is
 * decided HERE: PHONE_LOGIN_ENABLED off simply omits the phone row
 * (no dead buttons), and signed-in visitors never see the page - they
 * go wherever the auth gate says they belong.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[]; error?: string | string[] }>;
}) {
  const session = await auth();
  if (session) {
    // A session that still owes its first verified channel belongs HERE
    // (the gate answers "/login") - redirecting would loop. Everyone
    // else goes wherever the gate says they belong.
    const next = authNextStep(session.user);
    if (next !== "/login") redirect(next);
  }

  const params = await searchParams;
  const rawCallback = typeof params.callbackUrl === "string" ? params.callbackUrl : undefined;
  // Same-origin paths only - never an open redirect.
  const callbackUrl =
    rawCallback && rawCallback.startsWith("/") && !rawCallback.startsWith("//")
      ? rawCallback
      : "/discover";

  return (
    <LoginEntry
      phoneEnabled={phoneLoginEnabled()}
      callbackUrl={callbackUrl}
      errorCode={typeof params.error === "string" ? params.error : undefined}
    />
  );
}
