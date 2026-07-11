import { notFound, ok, requireSession } from "@/lib/api";
import { getAccountStatusView } from "@/lib/services/appeals";

/**
 * GET /api/account/status - the user-facing account status read model
 * (status card + violations with appeal state). This is the data source
 * for the phase-2 Appeals Centre (/account/status*).
 *
 * allowRestricted: suspended/banned sessions may (and must) read this -
 * it is how they learn what happened and appeal. Everything returned is
 * user-visible copy only; internal reasons/confidence never leave the
 * server (see appeals.ts boundary rule).
 */
export async function GET() {
  const { user, response } = await requireSession({ allowRestricted: true });
  if (response) return response;

  const view = await getAccountStatusView(user.id);
  if (!view) return notFound("Account");
  return ok(view);
}
