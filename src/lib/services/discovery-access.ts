import { requireActiveAccount, authError } from "@/lib/api";
import { resolveDatingEntry } from "@/lib/trust/account-capabilities";

/**
 * THE canonical Discovery VIEWER gate (L8.3.4F). Every Discovery-class route
 * (feed, explore, search, recommendations, public-profile preview) calls THIS
 * instead of a bare requireActiveAccount, so the decision "may this viewer
 * access Discovery?" lives in exactly one place - the capability resolver.
 *
 * Two-layer contract: this gates the VIEWER (canEnterDating). Candidate
 * eligibility ("who may APPEAR") is a separate decision owned by the canonical
 * query adapter DISCOVERABLE_USER_WHERE - never rebuilt in a route.
 *
 * Fail closed: requireActiveAccount rejects unauthenticated / suspended /
 * banned / registration-incomplete accounts; the capability check additionally
 * fails closed for DEACTIVATED (a tightening vs the old bare gate). SHADOW_BANNED
 * and profile-hidden viewers still browse (canEnterDating, not canAppearInDiscovery).
 */
type ViewerResult =
  | { user: NonNullable<Awaited<ReturnType<typeof requireActiveAccount>>["user"]>; response: null }
  | { user: null; response: Response };

export async function requireDiscoveryViewer(): Promise<ViewerResult> {
  const { user, response } = await requireActiveAccount();
  if (response || !user) {
    return { user: null, response: response ?? authError(401, "unauthenticated", "Sign in required.") };
  }
  // registrationComplete is guaranteed by requireActiveAccount above.
  const decision = resolveDatingEntry({ status: user.status, registrationComplete: true });
  if (!decision.allowed) {
    // Phase P: privacy-safe structured denial log - machine reason only, no
    // profile / verification / moderation detail.
    console.warn(
      `[discovery] viewer_denied capability=canEnterDating viewer=${user.id} reason=${decision.denialReasons[0]}`,
    );
    return {
      user: null,
      response: authError(403, "discovery_restricted", "Discovery is unavailable for this account."),
    };
  }
  return { user, response: null };
}
