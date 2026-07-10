import { apiError, guardRate, ok, parseBody, requireSession } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { swipeSchema } from "@/lib/validators/swipe";
import { planTierOf, recordSwipe, swipesRemainingToday, undoLastSwipe } from "@/lib/services/matching";
import { schedulePushDispatch } from "@/lib/services/notify";
import { SWIPE_LIMITS } from "@/lib/constants";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  const { user, response } = await requireSession();
  if (response) return response;

  const limited = await guardRate(`swipe:${user.id}`, RATE_LIMITS.swipe);
  if (limited) return limited;

  const { data, response: invalid } = await parseBody(req, swipeSchema);
  if (invalid) return invalid;

  if (data.toId === user.id) return apiError(400, "invalid_target", "You cannot swipe on yourself.");

  const target = await db.user.findUnique({
    where: { id: data.toId },
    select: { status: true },
  });
  if (!target || target.status !== "ACTIVE") {
    return apiError(404, "not_found", "This profile is no longer available.");
  }

  const tier = await planTierOf(user.id);
  if (data.action !== "PASS") {
    const remaining = await swipesRemainingToday(user.id, tier);
    if (data.action === "LIKE" && remaining.likes <= 0) {
      return apiError(402, "limit_reached", "You are out of likes for today. Upgrade for unlimited likes.");
    }
    if (data.action === "SUPER_LIKE" && remaining.superLikes <= 0) {
      return apiError(402, "limit_reached", "You are out of Super Likes for today.");
    }
  }

  const outcome = await recordSwipe(user.id, data.toId, data.action);
  // Match push (if any) goes out after the response - never blocks the swipe.
  if (outcome.matched) schedulePushDispatch();
  return ok(outcome);
}

/** DELETE = undo last swipe (Plus/Premium). */
export async function DELETE() {
  const { user, response } = await requireSession();
  if (response) return response;

  const tier = await planTierOf(user.id);
  if (!SWIPE_LIMITS[tier].undo) {
    return apiError(402, "upgrade_required", "Undo is available on Plus and Premium.");
  }

  const undone = await undoLastSwipe(user.id);
  if (!undone) return apiError(409, "nothing_to_undo", "Nothing to undo.");
  return ok({ undone: true });
}
