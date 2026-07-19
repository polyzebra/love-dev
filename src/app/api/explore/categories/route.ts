import { guardRate, ok, requireActiveAccount } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { getExploreCategories } from "@/lib/services/explore";

export async function GET() {
  const { user, response } = await requireActiveAccount();
  if (response) return response;
  const limited = await guardRate(`api:${user.id}`, RATE_LIMITS.api);
  if (limited) return limited;

  // Already grouped by taxonomy group, sorted and counted by the service.
  const groups = await getExploreCategories(user.id);
  return ok(groups);
}
