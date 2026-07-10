import { ok, parseBody, requireSession } from "@/lib/api";
import { recordAuthEvent } from "@/lib/auth/audit";
import { identityEventSchema, identityEventType } from "@/lib/validators/identity-event";

/**
 * POST /api/auth/identity-event { action: "link_started" | "unlink", provider? }
 *
 * Audit hook for Settings > Sign-in methods: records
 * auth_identity_linked / auth_identity_unlinked for the signed-in user.
 * The actual identity change happens client-side via Supabase
 * (linkIdentity / unlinkIdentity) - this route only writes the trail.
 */
export async function POST(req: Request) {
  const { user, response } = await requireSession();
  if (response) return response;

  const { data, response: invalid } = await parseBody(req, identityEventSchema);
  if (invalid) return invalid;

  await recordAuthEvent({
    type: identityEventType(data.action),
    userId: user.id,
    email: user.email,
    req,
    metadata: { provider: data.provider ?? null, source: "settings:sign-in-methods" },
  });

  return ok({ recorded: true });
}
