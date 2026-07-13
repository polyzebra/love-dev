import { notFound, ok, parseBody, requirePermission } from "@/lib/api";
import { db } from "@/lib/db";
import { exploreCategoryPatchSchema } from "@/lib/validators/admin";
import { updateExploreCategory } from "@/lib/services/explore";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/explore/categories/[id] - edit a category's
 * presentation fields (Phase 0E; previously a server action only).
 * Visibility and ordering have their own routes (toggle, move).
 */
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("flags:manage");
  if (response) return response;

  const { data, response: invalid } = await parseBody(req, exploreCategoryPatchSchema);
  if (invalid) return invalid;

  const category = await db.exploreCategory.findUnique({ where: { id }, select: { id: true } });
  if (!category) return notFound("Explore category");

  await updateExploreCategory({ actorId: actor.id, id, data });
  return ok({ id });
}
