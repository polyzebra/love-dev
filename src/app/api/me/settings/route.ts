import { ok, parseBody, requireSession } from "@/lib/api";
import { getUserSettings, settingsPatchSchema, updateUserSettings } from "@/lib/services/settings";

/**
 * GET/PATCH /api/me/settings - the canonical settings transport
 * (Phase 0E; previously a server action only). Identity comes from the
 * verified session - a userId in the payload is never read. Unknown or
 * mistyped fields are rejected by the strict schema before touching the
 * database.
 */
export async function GET() {
  const { user, response } = await requireSession();
  if (response) return response;
  return ok(await getUserSettings(user.id));
}

export async function PATCH(req: Request) {
  const { user, response } = await requireSession();
  if (response) return response;

  const { data, response: invalid } = await parseBody(req, settingsPatchSchema);
  if (invalid) return invalid;

  return ok(await updateUserSettings(user.id, data));
}
