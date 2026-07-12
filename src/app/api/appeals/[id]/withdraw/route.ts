import { apiError, guardRate, ok, requireSession } from "@/lib/api";
import { AppealError, withdrawAppeal } from "@/lib/services/appeals";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/appeals/[id]/withdraw - the user withdraws their OWN appeal,
 * only while it is pre-decision. Ownership is enforced inside the service
 * lookup (a foreign appeal id reads as 404 - no existence oracle).
 *
 * allowRestricted: suspended/banned users manage their appeals here.
 */
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const { user, response } = await requireSession({ allowRestricted: true });
  if (response) return response;

  const limited = await guardRate(`appeal-manage:${user.id}`, { limit: 10, windowMs: 60 * 60_000 });
  if (limited) return limited;

  try {
    const result = await withdrawAppeal({ userId: user.id, appealId: id });
    return ok({
      appealId: result.appealId,
      status: result.status,
      message: "Your appeal was withdrawn. You can submit a new one any time.",
    });
  } catch (error) {
    if (error instanceof AppealError) {
      return apiError(error.httpStatus, error.code, error.message);
    }
    throw error;
  }
}
