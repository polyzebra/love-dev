import { db } from "@/lib/db";
import { z } from "zod";

/**
 * Per-user preference persistence. Reads lazily create the defaults
 * row so every user always has settings; writes are whitelisted field
 * by field - the user id always comes from the verified session,
 * never from the client payload.
 */

export const settingsPatchSchema = z
  .object({
    emailNewMatches: z.boolean(),
    emailMessages: z.boolean(),
    emailPromotions: z.boolean(),
    pushNewMatches: z.boolean(),
    pushMessages: z.boolean(),
    pushMessageLikes: z.boolean(),
    pushSuperLikes: z.boolean(),
    pushDailyPicks: z.boolean(),
    pushOffers: z.boolean(),
    smsEnabled: z.boolean(),
    inAppVibrations: z.boolean(),
    inAppSounds: z.boolean(),
    safetyPush: z.boolean(),
    accountPush: z.boolean(),
    safetyEmail: z.boolean(),
    accountEmail: z.boolean(),
    safetySms: z.boolean(),
    accountSms: z.boolean(),
    quietHoursEnabled: z.boolean(),
    // Minutes since local midnight (0-1439); null clears the bound.
    quietHoursStart: z.number().int().min(0).max(1439).nullable(),
    quietHoursEnd: z.number().int().min(0).max(1439).nullable(),
    // IANA timezone name; unknown names are evaluated as UTC server-side.
    timezone: z.string().min(1).max(64).nullable(),
    appearance: z.enum(["SYSTEM", "LIGHT", "DARK"]),
  })
  .partial()
  .strict();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export async function getUserSettings(userId: string) {
  const existing = await db.userSettings.findUnique({ where: { userId } });
  if (existing) return existing;
  // First visit: create the defaults row ATOMICALLY. `upsert` with an empty
  // update is NOT atomic under Prisma's driver adapters (SELECT then INSERT),
  // so concurrent first-visit renders - the page plus the nav's prefetches,
  // which all run the (app) layout - raced it and the losers threw P2002,
  // 500ing the page. createMany + skipDuplicates compiles to
  // INSERT ... ON CONFLICT DO NOTHING, which every racer survives.
  await db.userSettings.createMany({ data: [{ userId }], skipDuplicates: true });
  return db.userSettings.findUniqueOrThrow({ where: { userId } });
}

export async function updateUserSettings(userId: string, patch: SettingsPatch) {
  const data = settingsPatchSchema.parse(patch);
  return db.userSettings.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
}
