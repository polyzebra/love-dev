import { guardRate, ok, parseBody, requireSession } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { track } from "@/lib/services/explore";
import { z } from "zod";

const schema = z.object({
  name: z.enum([
    "explore_profile_opened",
    "explore_profile_closed",
    "explore_profile_photo_changed",
    "explore_profile_liked",
    "explore_profile_passed",
    "explore_profile_clicked",
  ]),
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export async function POST(req: Request) {
  const { user, response } = await requireSession();
  if (response) return response;
  const limited = await guardRate(`analytics:${user.id}`, RATE_LIMITS.api);
  if (limited) return limited;
  const { data, response: invalid } = await parseBody(req, schema);
  if (invalid) return invalid;
  track(data.name, user.id, data.data);
  return ok({ tracked: true });
}
