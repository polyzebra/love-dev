import { z } from "zod";
import { ok, apiError, validationError, requirePermission, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getSupportRequest, updateSupportRequest, type SupportPatch } from "@/lib/services/support";

const patchSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_USER", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  spam: z.boolean().optional(),
  assign: z.enum(["me", "none"]).optional(),
});

/** PATCH /api/admin/support/:id - update status/priority/spam/assignment. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requirePermission("support:manage");
  if (response) return response;

  const { id } = await params;
  const existing = await getSupportRequest(id);
  if (!existing) return notFound("Support request");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "invalid_json", "Request body must be valid JSON.");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const patch: SupportPatch = {};
  if (parsed.data.status) patch.status = parsed.data.status;
  if (parsed.data.priority) patch.priority = parsed.data.priority;
  if (typeof parsed.data.spam === "boolean") patch.spam = parsed.data.spam;
  if (parsed.data.assign === "me") patch.assignedAdmin = user.id;
  if (parsed.data.assign === "none") patch.assignedAdmin = null;

  if (Object.keys(patch).length === 0) {
    return apiError(400, "no_op", "Nothing to update.");
  }

  const updated = await updateSupportRequest(id, patch);
  await audit({
    actorId: user.id,
    action: "support.update",
    targetType: "SupportRequest",
    targetId: id,
    metadata: {
      status: parsed.data.status ?? null,
      priority: parsed.data.priority ?? null,
      spam: parsed.data.spam ?? null,
      assign: parsed.data.assign ?? null,
    },
  });
  return ok({
    id: updated.id,
    status: updated.status,
    priority: updated.priority,
    spam: updated.spam,
    assignedAdmin: updated.assignedAdmin,
  });
}
