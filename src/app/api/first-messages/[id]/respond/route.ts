import { apiError, guardRate, ok, parseBody, requireSession } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { respondFirstMessageSchema } from "@/lib/validators/first-message";
import {
  FIRST_MESSAGE_ERROR_STATUS,
  FirstMessageError,
  respondToFirstMessage,
} from "@/lib/services/first-messages";
import { schedulePushDispatch } from "@/lib/services/notify";

type Params = { params: Promise<{ id: string }> };

/** POST /api/first-messages/[id]/respond - accept or decline (receiver only). */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user, response } = await requireSession();
  if (response) return response;

  const limited = await guardRate(`first-message-respond:${user.id}`, RATE_LIMITS.api);
  if (limited) return limited;

  const { data, response: invalid } = await parseBody(req, respondFirstMessageSchema);
  if (invalid) return invalid;

  try {
    // Ownership (session user must be the receiver) is enforced in the service.
    const result = await respondToFirstMessage(user.id, id, data.action);
    // Accepting creates match notifications - dispatch push post-response.
    if (result.status === "ACCEPTED") schedulePushDispatch();
    return ok(result);
  } catch (error) {
    if (error instanceof FirstMessageError) {
      return apiError(FIRST_MESSAGE_ERROR_STATUS[error.code], error.code, error.message);
    }
    throw error;
  }
}
