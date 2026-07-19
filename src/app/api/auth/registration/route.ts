import { ok, requireSession } from "@/lib/api";
import { registrationProgress } from "@/lib/auth/gate";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/auth/registration - the canonical registration-status contract
 * (L7.3.8). Returns the current registration state, the next required step,
 * completion percentage, and the remaining required actions - derived by the
 * ONE resolver (registrationProgress -> authNextStep). Every client polling
 * registration progress reads this; every registration step route returns the
 * same shape.
 *
 * Uses requireSession with allowRestricted so a suspended/banned account can
 * still read its own state (BLOCKED) - it is a read model, not a feature.
 */
export async function GET() {
  const { user, response } = await requireSession({ allowRestricted: true });
  if (response) return response;
  return ok(registrationProgress(user));
}
