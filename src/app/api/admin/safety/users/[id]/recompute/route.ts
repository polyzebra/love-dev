import { notFound, ok, requirePermission } from "@/lib/api";
import { audit } from "@/lib/audit";
import { computeScamScore } from "@/lib/services/scam";
import { computeTrustProfile } from "@/lib/services/trust-engine";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/safety/users/[id]/recompute - admin-triggered trust
 * recompute: refreshes the behavioural scam score first, then the
 * composite trust profile. Returns the full staff-side profile
 * (never exposed to the user themselves).
 */
export async function POST(req: Request, { params }: Params) {
  void req;
  const { id } = await params;
  const { user: actor, response } = await requirePermission("safety:manage");
  if (response) return response;

  await computeScamScore(id);
  const profile = await computeTrustProfile(id);
  if (!profile) return notFound("User");

  await audit({
    actorId: actor.id,
    action: "safety.trust.recompute",
    targetType: "user",
    targetId: id,
    metadata: { riskScore: profile.riskScore, recommendedAction: profile.recommendedAction },
  });

  return ok({ profile });
}
