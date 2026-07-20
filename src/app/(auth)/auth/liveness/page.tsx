import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { authNextStep, LIVENESS_STEP } from "@/lib/auth/gate";
import { BIOMETRIC_CONSENT_VERSION } from "@/lib/services/face-verification";
import { LivenessEntryStep } from "@/components/auth/LivenessEntryStep";

export const metadata: Metadata = {
  title: "Quick face check - Tirvea",
};

/**
 * L8.1.1 The one-time AWS Face Liveness entry step. Access is derived ENTIRELY
 * from the canonical registration resolver (authNextStep) - this page never
 * re-implements ladder logic:
 *
 *   - unauthenticated               -> requireUser redirects to /login
 *   - an earlier rung is owed       -> requireUser redirects to that step
 *   - suspended/banned/restricted   -> requireUser redirects (fail closed)
 *   - liveness is the current rung  -> render (allow = LIVENESS_STEP)
 *   - already passed / complete     -> redirect to /discover
 *
 * DORMANT-SAFE: while LIVENESS_ENTRY_GATE is off, authNextStep never returns
 * LIVENESS_STEP, so this page always redirects (never renders) - deploying it
 * changes nothing until the gate is deliberately activated.
 */
export default async function LivenessPage() {
  const user = await requireUser({ allow: LIVENESS_STEP });
  // requireUser has already bounced unauthenticated, restricted, and
  // earlier-step users. Remaining: owed liveness (render) OR complete (leave).
  if (authNextStep(user) !== LIVENESS_STEP) redirect("/discover");
  return <LivenessEntryStep consentVersion={BIOMETRIC_CONSENT_VERSION} />;
}
