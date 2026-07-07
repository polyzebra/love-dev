import { guardRate, ok, requireSession } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { getExploreCategories } from "@/lib/services/explore";

export async function GET() {
  const { user, response } = await requireSession();
  if (response) return response;
  const limited = await guardRate(`api:${user.id}`, RATE_LIMITS.api);
  if (limited) return limited;

  const categories = await getExploreCategories(user.id);
  const grouped: Record<string, typeof categories> = {};
  for (const c of categories) (grouped[c.group] ??= []).push(c);
  return ok(grouped);
}
