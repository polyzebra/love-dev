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
    appearance: z.enum(["SYSTEM", "LIGHT", "DARK"]),
  })
  .partial()
  .strict();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export async function getUserSettings(userId: string) {
  return db.userSettings.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

export async function updateUserSettings(userId: string, patch: SettingsPatch) {
  const data = settingsPatchSchema.parse(patch);
  return db.userSettings.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
}
