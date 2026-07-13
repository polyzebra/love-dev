import { notFound, ok, parseBody, requirePermission } from "@/lib/api";
import { db } from "@/lib/db";
import { exploreCategoryMoveSchema } from "@/lib/validators/admin";
import { moveExploreCategory } from "@/lib/services/explore";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/explore/categories/[id]/move - swap sort positions
 * with the nearest neighbour in the same group (Phase 0E; previously a
 * server action only). moved:false = already at the edge, nothing done.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("flags:manage");
  if (response) return response;

  const { data, response: invalid } = await parseBody(req, exploreCategoryMoveSchema);
  if (invalid) return invalid;

  const category = await db.exploreCategory.findUnique({ where: { id }, select: { id: true } });
  if (!category) return notFound("Explore category");

  const moved = await moveExploreCategory({ actorId: actor.id, id, direction: data.direction });
  return ok({ id, moved });
}
