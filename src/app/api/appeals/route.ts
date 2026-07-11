import { z } from "zod";
import { apiError, created, guardRate, parseBody, requireSession } from "@/lib/api";
import { AppealError, submitAppeal } from "@/lib/services/appeals";

const appealSchema = z
  .object({
    violationId: z.string().min(1),
    appealText: z.string().min(10).max(2000),
  })
  .strict();

/**
 * POST /api/appeals - submit an appeal against one violation.
 *
 * allowRestricted: appeal-after-ban is the core use case - suspended and
 * banned sessions must be able to reach this route. The service enforces
 * ownership, appealAllowed, one-open-appeal-per-violation (409 on double
 * appeal) and the per-day cap; the route adds the sliding-window rate
 * limit.
 */
export async function POST(req: Request) {
  const { user, response } = await requireSession({ allowRestricted: true });
  if (response) return response;

  const limited = await guardRate(`appeal:${user.id}`, { limit: 5, windowMs: 60 * 60_000 });
  if (limited) return limited;

  const { data, response: invalid } = await parseBody(req, appealSchema);
  if (invalid) return invalid;

  try {
    const result = await submitAppeal({
      userId: user.id,
      violationId: data.violationId,
      appealText: data.appealText,
    });
    return created({
      appealId: result.appealId,
      status: result.status,
      message: "Your appeal was submitted. A member of our team will review it personally.",
    });
  } catch (error) {
    if (error instanceof AppealError) {
      return apiError(error.httpStatus, error.code, error.message);
    }
    throw error;
  }
}
