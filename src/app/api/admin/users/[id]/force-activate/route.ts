import { z } from "zod";
import { apiError, ok, requirePermission, validationError } from "@/lib/api";
import { db } from "@/lib/db";
import { activateAccountIfComplete, RegistrationStateViolation } from "@/lib/auth/identity";

type Params = { params: Promise<{ id: string }> };

const forceActivateSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

/**
 * POST /api/admin/users/[id]/force-activate  { reason }
 *
 * SUPER_ADMIN-only manual activation (L7.3.9 Phase H). This is the ONLY admin
 * path that may complete a registration, and it goes through the SINGLE
 * canonical activator with `force` - which still refuses a suspended/banned or
 * already-complete account (RegistrationStateViolation) and writes a full audit
 * record (previous state, new state, actor, manual, reason). There is no
 * "Set ACTIVE" / "Set registration complete" raw control anywhere.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("users:activate");
  if (response) return response;

  const body = await req.json().catch(() => ({}));
  const parsed = forceActivateSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const target = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) return apiError(404, "not_found", "User not found.");

  try {
    const result = await activateAccountIfComplete(id, {
      force: { actorId: actor.id, reason: parsed.data.reason },
      requestId: req.headers.get("x-vercel-id") ?? req.headers.get("x-request-id"),
    });
    return ok({ id, activated: result.activated, state: result.state, reason: result.reason });
  } catch (error) {
    if (error instanceof RegistrationStateViolation) {
      return apiError(409, "registration_state_violation", error.message);
    }
    throw error;
  }
}
