import { created, parseBody, requireSession } from "@/lib/api";
import { onboardingSchema } from "@/lib/validators/profile";
import { completeOnboarding } from "@/lib/services/profile";

export async function POST(req: Request) {
  const { user, response } = await requireSession();
  if (response) return response;

  const { data, response: invalid } = await parseBody(req, onboardingSchema);
  if (invalid) return invalid;

  const profile = await completeOnboarding(user.id, data);
  return created({ profileId: profile.id });
}
