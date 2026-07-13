import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

/**
 * Feature-flag administration. Routes own the permission checks
 * (requirePermission("flags:manage")) - this owns the mutation + audit,
 * so it is directly exercisable by tests.
 */
export async function setFeatureFlag(opts: {
  actorId: string;
  key: string;
  enabled: boolean;
}): Promise<void> {
  await db.featureFlag.upsert({
    where: { key: opts.key },
    create: { key: opts.key, enabled: opts.enabled },
    update: { enabled: opts.enabled },
  });
  await audit({
    actorId: opts.actorId,
    action: "flag.update",
    targetType: "flag",
    targetId: opts.key,
    metadata: { enabled: opts.enabled },
  });
}
