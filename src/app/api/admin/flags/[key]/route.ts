import { apiError, ok, parseBody, requirePermission } from "@/lib/api";
import { featureFlagKeySchema, featureFlagSetSchema } from "@/lib/validators/admin";
import { setFeatureFlag } from "@/lib/services/feature-flags";

type Params = { params: Promise<{ key: string }> };

/**
 * PUT /api/admin/flags/[key] - idempotent set of a feature flag
 * (Phase 0E; previously a server action only). Upserts, so a flag that
 * only exists in code gains its row on first write. Lands in AdminLog.
 */
export async function PUT(req: Request, { params }: Params) {
  const { key: rawKey } = await params;
  const { user: actor, response } = await requirePermission("flags:manage");
  if (response) return response;

  const key = featureFlagKeySchema.safeParse(decodeURIComponent(rawKey));
  if (!key.success) {
    return apiError(422, "validation_error", "That is not a valid feature-flag key.");
  }

  const { data, response: invalid } = await parseBody(req, featureFlagSetSchema);
  if (invalid) return invalid;

  await setFeatureFlag({ actorId: actor.id, key: key.data, enabled: data.enabled });
  return ok({ key: key.data, enabled: data.enabled });
}
