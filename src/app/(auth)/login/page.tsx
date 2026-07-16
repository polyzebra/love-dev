import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveLoginView } from "@/lib/auth/gate";
import { phoneLoginEnabled } from "@/lib/auth/phone";
import { LoginEntry } from "@/components/auth/LoginEntry";
import { LoginRecovery } from "@/components/auth/LoginRecovery";

export const metadata: Metadata = {
  title: "Sign in - Tirvea",
  description: "Sign in or create your Tirvea account.",
};

/**
 * /login - the auth front door. Server component so availability is
 * decided HERE: PHONE_LOGIN_ENABLED off simply omits the phone row (no
 * dead buttons). The single decision resolveLoginView() keeps auth state
 * and navigation intent separate: an authenticated but incompletely
 * onboarded visitor is offered a RECOVERY screen here (continue setup /
 * use another account / sign out) rather than being forced back into the
 * setup ladder - only a restricted account is redirected. Unauthenticated
 * visitors (and fresh accounts still owing a first channel) see the
 * method chooser.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[]; error?: string | string[] }>;
}) {
  const session = await auth();
  const view = resolveLoginView(session);
  if (view.kind === "redirect") redirect(view.to);

  const params = await searchParams;
  const rawCallback = typeof params.callbackUrl === "string" ? params.callbackUrl : undefined;
  // Same-origin paths only - never an open redirect.
  const callbackUrl =
    rawCallback && rawCallback.startsWith("/") && !rawCallback.startsWith("//")
      ? rawCallback
      : "/discover";

  if (view.kind === "recovery") {
    // Continue setup -> the exact rung the gate points at; a fully set-up
    // account continues into the app (callbackUrl, default /discover).
    return (
      <LoginRecovery
        continueHref={view.setupComplete ? callbackUrl : view.next}
        setupComplete={view.setupComplete}
      />
    );
  }

  return (
    <LoginEntry
      phoneEnabled={phoneLoginEnabled()}
      callbackUrl={callbackUrl}
      errorCode={typeof params.error === "string" ? params.error : undefined}
    />
  );
}
