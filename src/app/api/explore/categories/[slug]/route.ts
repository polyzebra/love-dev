import { apiError, guardRate, ok, requireActiveAccount } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { exploreFiltersSchema } from "@/lib/validators/explore";
import { getExploreMatches, track } from "@/lib/services/explore";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, response } = await requireActiveAccount();
  if (response) return response;
  const limited = await guardRate(`api:${user.id}`, RATE_LIMITS.api);
  if (limited) return limited;

  const parsed = exploreFiltersSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return apiError(422, "validation_error", "Invalid filters.");

  const result = await getExploreMatches(user.id, slug, parsed.data);
  if (!result) return apiError(404, "not_found", "Category not found or inactive.");

  track("explore_category_viewed", user.id, { slug, filters: parsed.data });
  if (Object.keys(parsed.data).some((k) => k !== "page" && k !== "pageSize")) {
    track("explore_filter_used", user.id, { slug, filters: parsed.data });
  }
  return ok(result);
}
