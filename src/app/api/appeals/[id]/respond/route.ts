import { z } from "zod";
import { apiError, guardRate, ok, parseBody, requireSession } from "@/lib/api";
import { AppealError, respondAppealInfo } from "@/lib/services/appeals";

const respondSchema = z
  .object({
    message: z.string().min(3).max(2000),
  })
  .strict();

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/appeals/[id]/respond - the user answers a staff NEEDS_INFO
 * question (one reply per round trip; the appeal returns to UNDER_REVIEW).
 * Ownership enforced inside the service lookup (foreign id -> 404).
 *
 * allowRestricted: suspended/banned users manage their appeals here.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user, response } = await requireSession({ allowRestricted: true });
  if (response) return response;

  const limited = await guardRate(`appeal-manage:${user.id}`, { limit: 10, windowMs: 60 * 60_000 });
  if (limited) return limited;

  const { data, response: invalid } = await parseBody(req, respondSchema);
  if (invalid) return invalid;

  try {
    const result = await respondAppealInfo({
      userId: user.id,
      appealId: id,
      message: data.message,
    });
    return ok({
      appealId: result.appealId,
      status: result.status,
      message: "Thanks - your reply was added and our team will continue the review.",
    });
  } catch (error) {
    if (error instanceof AppealError) {
      return apiError(error.httpStatus, error.code, error.message);
    }
    throw error;
  }
}
