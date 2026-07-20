import { guardRate, ok } from "@/lib/api";
import { requireDiscoveryViewer } from "@/lib/services/discovery-access";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { getDiscoverFeed } from "@/lib/services/discovery";

export async function GET(req: Request) {
  const { user, response } = await requireDiscoveryViewer();
  if (response) return response;

  const limited = await guardRate(`api:${user.id}`, RATE_LIMITS.api);
  if (limited) return limited;

  const url = new URL(req.url);
  const take = Math.min(Number(url.searchParams.get("take") ?? 20), 50);

  const feed = await getDiscoverFeed(user.id, take);
  return ok(feed);
}
