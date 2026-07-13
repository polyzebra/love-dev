import { guardRate, notFound, ok, parseBody, requireSession } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { profilePromptsSchema } from "@/lib/validators/profile";
import { replaceProfilePrompts } from "@/lib/services/profile";

/**
 * PUT /api/profile/prompts - replace the user's prompt answers with the
 * submitted set (Phase 0E; previously a server action only). PUT because
 * the payload IS the complete new answer set - resubmitting is a no-op.
 * 404 = no profile yet; clients send the user through onboarding.
 */
export async function PUT(req: Request) {
  const { user, response } = await requireSession();
  if (response) return response;

  const limited = await guardRate(`profile-write:${user.id}`, RATE_LIMITS.profileWrite);
  if (limited) return limited;

  const { data, response: invalid } = await parseBody(req, profilePromptsSchema);
  if (invalid) return invalid;

  const result = await replaceProfilePrompts(user.id, data);
  if (!result) return notFound("Profile");
  return ok(result);
}
