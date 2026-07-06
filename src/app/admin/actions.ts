"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hasPermission, type Permission } from "@/lib/rbac";

async function requireActor(permission: Permission) {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.role, permission)) {
    throw new Error("Forbidden");
  }
  return session.user;
}

export async function setUserStatus(userId: string, status: "ACTIVE" | "SUSPENDED" | "SHADOW_BANNED") {
  const actor = await requireActor("users:suspend");
  await db.user.update({ where: { id: userId }, data: { status } });
  await audit({
    actorId: actor.id,
    action: `user.status.${status.toLowerCase()}`,
    targetType: "user",
    targetId: userId,
  });
  revalidatePath("/admin/users");
}

export async function resolveReport(
  reportId: string,
  outcome: "ACTION_TAKEN" | "DISMISSED",
  resolution?: string,
) {
  const actor = await requireActor("reports:resolve");
  await db.report.update({
    where: { id: reportId },
    data: {
      status: outcome,
      resolvedById: actor.id,
      resolvedAt: new Date(),
      resolution,
    },
  });
  await audit({
    actorId: actor.id,
    action: `report.${outcome === "ACTION_TAKEN" ? "action" : "dismiss"}`,
    targetType: "report",
    targetId: reportId,
  });
  revalidatePath("/admin/reports");
}

export async function reviewVerification(verificationId: string, approve: boolean) {
  const actor = await requireActor("verifications:review");
  const verification = await db.verification.update({
    where: { id: verificationId },
    data: {
      status: approve ? "APPROVED" : "REJECTED",
      reviewedById: actor.id,
    },
  });
  if (approve) {
    await db.notification.create({
      data: {
        userId: verification.userId,
        type: "PROFILE_VERIFIED",
        title: "You're verified!",
        body: "Your verification was approved. Your badge is now live.",
      },
    });
  }
  await audit({
    actorId: actor.id,
    action: `verification.${approve ? "approve" : "reject"}`,
    targetType: "verification",
    targetId: verificationId,
  });
  revalidatePath("/admin/verification");
}

export async function toggleFeatureFlag(key: string, enabled: boolean) {
  const actor = await requireActor("flags:manage");
  await db.featureFlag.upsert({
    where: { key },
    create: { key, enabled },
    update: { enabled },
  });
  await audit({
    actorId: actor.id,
    action: "flag.update",
    targetType: "flag",
    targetId: key,
    metadata: { enabled },
  });
  revalidatePath("/admin/flags");
}
