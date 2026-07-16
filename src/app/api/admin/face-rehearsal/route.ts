import { ok, requirePermission } from "@/lib/api";
import { evaluateRehearsalGates, REHEARSAL_JOURNEY } from "@/lib/services/face-rehearsal";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/face-rehearsal - admin-only STATUS VIEW for the internal
 * rehearsal. Staff-only (verifications:review). Read-only: reports whether
 * the eight hard gates pass and lists the planned journey. It never runs
 * anything, never returns a secret, and never returns a biometric identifier
 * (only normalized gate ids/titles + boolean readiness).
 */
export async function GET() {
  const { response } = await requirePermission("verifications:review");
  if (response) return response;
  const gates = evaluateRehearsalGates();
  return ok({
    ready: gates.ready,
    gates: gates.gates.map((g) => ({ id: g.id, title: g.title, ok: g.ok, detail: g.detail })),
    journey: REHEARSAL_JOURNEY,
  });
}
