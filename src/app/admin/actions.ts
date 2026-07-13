"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hasPermission, type Permission } from "@/lib/rbac";
import { sendSafetyNotice } from "@/lib/services/safety-notices";

async function requireActor(permission: Permission) {
  const session = await auth();
  // Status check matters now that auth() keeps suspended/banned sessions
  // alive for the appeal surfaces - a restricted staff account may not act.
  if (
    !session?.user?.id ||
    session.user.status !== "ACTIVE" ||
    !hasPermission(session.user.role, permission)
  ) {
    throw new Error("Forbidden");
  }
  return session.user;
}

export async function setUserStatus(
  userId: string,
  status: "ACTIVE" | "SUSPENDED" | "SHADOW_BANNED",
) {
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
  // The verdict lives on User columns (see lib/services/verification.ts);
  // the Verification row is provider workflow state. A PHOTO review must
  // stamp/clear User.photoVerifiedAt atomically with the row update or the
  // badge surfaces and the review queue would disagree.
  const verification = await db.$transaction(async (tx) => {
    const row = await tx.verification.update({
      where: { id: verificationId },
      data: {
        status: approve ? "APPROVED" : "REJECTED",
        reviewedById: actor.id,
      },
    });
    if (row.type === "PHOTO") {
      await tx.user.update({
        where: { id: row.userId },
        data: { photoVerifiedAt: approve ? new Date() : null },
      });
    }
    return row;
  });
  // Notify through the outbox (in-app + push + email per prefs) - a bare
  // Notification row would silently skip email/push delivery.
  await sendSafetyNotice(
    verification.userId,
    approve ? "verification_approved" : "verification_rejected",
    `verification:${verificationId}:${approve ? "approved" : "rejected"}:staff`,
    { verificationId },
  );
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

export async function toggleExploreCategory(id: string, isActive: boolean) {
  const actor = await requireActor("flags:manage");
  await db.exploreCategory.update({ where: { id }, data: { isActive } });
  await audit({
    actorId: actor.id,
    action: "explore.toggle",
    targetType: "exploreCategory",
    targetId: id,
    metadata: { isActive },
  });
  revalidatePath("/admin/explore");
  revalidatePath("/explore");
}

export async function moveExploreCategory(id: string, direction: "up" | "down") {
  const actor = await requireActor("flags:manage");
  const cat = await db.exploreCategory.findUniqueOrThrow({ where: { id } });
  const neighbour = await db.exploreCategory.findFirst({
    where: {
      group: cat.group,
      sortOrder: direction === "up" ? { lt: cat.sortOrder } : { gt: cat.sortOrder },
    },
    orderBy: { sortOrder: direction === "up" ? "desc" : "asc" },
  });
  if (!neighbour) return;
  await db.$transaction([
    db.exploreCategory.update({ where: { id: cat.id }, data: { sortOrder: neighbour.sortOrder } }),
    db.exploreCategory.update({ where: { id: neighbour.id }, data: { sortOrder: cat.sortOrder } }),
  ]);
  await audit({
    actorId: actor.id,
    action: "explore.reorder",
    targetType: "exploreCategory",
    targetId: id,
  });
  revalidatePath("/admin/explore");
  revalidatePath("/explore");
}

export async function updateExploreCategory(
  id: string,
  data: {
    title?: string;
    description?: string;
    gradientFrom?: string;
    gradientTo?: string;
    iconKey?: string;
    imageUrl?: string | null;
  },
) {
  const actor = await requireActor("flags:manage");
  await db.exploreCategory.update({ where: { id }, data });
  await audit({
    actorId: actor.id,
    action: "explore.update",
    targetType: "exploreCategory",
    targetId: id,
    metadata: data,
  });
  revalidatePath("/admin/explore");
  revalidatePath("/explore");
}
