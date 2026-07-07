import { ok, requireSession } from "@/lib/api";
import { db } from "@/lib/db";
import { track } from "@/lib/services/explore";

export async function DELETE(_req: Request, { params }: { params: Promise<{ categoryId: string }> }) {
  const { categoryId } = await params;
  const { user, response } = await requireSession();
  if (response) return response;

  await db.userExplorePreference
    .delete({ where: { userId_categoryId: { userId: user.id, categoryId } } })
    .catch(() => {});
  track("explore_preference_removed", user.id, { categoryId });
  return ok({ removed: true });
}
