import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Append-only audit trail for privileged and safety-relevant actions.
 * Never throws — an audit failure must not break the primary operation,
 * but it is always logged.
 */
export async function audit(entry: {
  actorId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string;
}): Promise<void> {
  try {
    await db.adminLog.create({ data: entry });
  } catch (error) {
    console.error("[audit] failed to record entry", entry.action, error);
  }
}
