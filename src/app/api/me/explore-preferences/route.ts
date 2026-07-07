import { apiError, created, ok, parseBody, requireSession } from "@/lib/api";
import { z } from "zod";
import { db } from "@/lib/db";
import { track } from "@/lib/services/explore";

const schema = z.object({ categoryId: z.string().min(1), weight: z.number().int().min(1).max(10).optional() });

export async function POST(req: Request) {
  const { user, response } = await requireSession();
  if (response) return response;
  const { data, response: invalid } = await parseBody(req, schema);
  if (invalid) return invalid;

  const category = await db.exploreCategory.findUnique({ where: { id: data.categoryId } });
  if (!category?.isActive) return apiError(404, "not_found", "Category not found.");

  await db.userExplorePreference.upsert({
    where: { userId_categoryId: { userId: user.id, categoryId: data.categoryId } },
    create: { userId: user.id, categoryId: data.categoryId, weight: data.weight ?? 1 },
    update: { weight: data.weight ?? 1 },
  });
  track("explore_preference_added", user.id, { categoryId: data.categoryId, slug: category.slug });
  return created({ saved: true });
}

export async function GET() {
  const { user, response } = await requireSession();
  if (response) return response;
  const prefs = await db.userExplorePreference.findMany({
    where: { userId: user.id },
    select: { categoryId: true, weight: true, category: { select: { slug: true, title: true } } },
  });
  return ok(prefs);
}
