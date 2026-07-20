import { apiError, guardRate, ok } from "@/lib/api";
import { requireDiscoveryViewer } from "@/lib/services/discovery-access";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { getExploreProfile } from "@/lib/services/explore";

/** Next-profile loader for the immersive viewer queue. */
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId: targetId } = await params;
  const { user, response } = await requireDiscoveryViewer();
  if (response) return response;
  const limited = await guardRate(`api:${user.id}`, RATE_LIMITS.api);
  if (limited) return limited;

  const profile = await getExploreProfile(user.id, targetId);
  if (!profile) return apiError(404, "not_found", "Profile unavailable.");
  return ok(profile);
}
