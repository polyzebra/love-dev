import { created, guardRate, parseBody, requireSession } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { onboardingSchema } from "@/lib/validators/profile";
import { completeOnboarding } from "@/lib/services/profile";

export async function POST(req: Request) {
  const { user, response } = await requireSession();
  if (response) return response;

  const limited = await guardRate(`profile-write:${user.id}`, RATE_LIMITS.profileWrite);
  if (limited) return limited;

  const { data, response: invalid } = await parseBody(req, onboardingSchema);
  if (invalid) return invalid;

  const profile = await completeOnboarding(user.id, data);
  return created({ profileId: profile.id });
}
