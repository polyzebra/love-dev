"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import {
  settingsPatchSchema,
  updateUserSettings,
  type SettingsPatch,
} from "@/lib/services/settings";

/**
 * The only write path for user settings. Identity comes from the
 * verified session (requireUser) - a userId in the payload is never
 * read. Unknown or non-boolean fields are rejected by the strict
 * schema before touching the database.
 */
export async function saveSettings(patch: SettingsPatch) {
  const user = await requireUser();
  const parsed = settingsPatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false as const, error: "Invalid settings payload." };
  }
  try {
    const settings = await updateUserSettings(user.id, parsed.data);
    revalidatePath("/settings", "layout");
    return { ok: true as const, settings };
  } catch {
    return { ok: false as const, error: "Could not save right now. Try again." };
  }
}
