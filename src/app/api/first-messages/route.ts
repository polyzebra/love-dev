import { apiError, created, guardRate, ok, parseBody, requireActiveAccount } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { sendFirstMessageSchema } from "@/lib/validators/first-message";
import {
  FIRST_MESSAGE_ERROR_STATUS,
  FirstMessageError,
  listFirstMessagesFor,
  sendFirstMessage,
} from "@/lib/services/first-messages";
import { schedulePushDispatch } from "@/lib/services/notify";

/** POST /api/first-messages - send a message before matching (with a Like). */
export async function POST(req: Request) {
  const { user, response } = await requireActiveAccount();
  if (response) return response;

  const limited = await guardRate(`first-message:${user.id}`, RATE_LIMITS.message);
  if (limited) return limited;

  const { data, response: invalid } = await parseBody(req, sendFirstMessageSchema);
  if (invalid) return invalid;

  try {
    // Sender is ALWAYS the session user - never trusted from the client.
    const result = await sendFirstMessage(user.id, data.toId, data.body);
    // Push (first-message or instant-match) goes out after the response.
    schedulePushDispatch();
    // 201: the sheet treats anything else as a failure.
    return created(result);
  } catch (error) {
    if (error instanceof FirstMessageError) {
      return apiError(FIRST_MESSAGE_ERROR_STATUS[error.code], error.code, error.message);
    }
    throw error;
  }
}

/** GET /api/first-messages - pending inbox for the Likes page. */
export async function GET() {
  const { user, response } = await requireActiveAccount();
  if (response) return response;

  return ok(await listFirstMessagesFor(user.id));
}
