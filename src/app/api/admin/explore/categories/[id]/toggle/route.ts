import { notFound, ok, parseBody, requirePermission } from "@/lib/api";
import { db } from "@/lib/db";
import { exploreCategoryToggleSchema } from "@/lib/validators/admin";
import { toggleExploreCategory } from "@/lib/services/explore";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/explore/categories/[id]/toggle - show/hide a category
 * on the public explore surface (Phase 0E; previously a server action).
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("flags:manage");
  if (response) return response;

  const { data, response: invalid } = await parseBody(req, exploreCategoryToggleSchema);
  if (invalid) return invalid;

  const category = await db.exploreCategory.findUnique({ where: { id }, select: { id: true } });
  if (!category) return notFound("Explore category");

  await toggleExploreCategory({ actorId: actor.id, id, isActive: data.isActive });
  return ok({ id, isActive: data.isActive });
}
