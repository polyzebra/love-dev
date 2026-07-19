import { z } from "zod";
import { created, apiError, validationError, requirePermission, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getSupportRequest, addSupportNote } from "@/lib/services/support";

const noteSchema = z.object({ body: z.string().trim().min(1).max(4000) });

/** POST /api/admin/support/:id/note - append a staff-internal note. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const parsed = noteSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const note = await addSupportNote(id, user.id, parsed.data.body);
  await audit({
    actorId: user.id,
    action: "support.note",
    targetType: "SupportRequest",
    targetId: id,
  });
  return created({ id: note.id, createdAt: note.createdAt });
}
