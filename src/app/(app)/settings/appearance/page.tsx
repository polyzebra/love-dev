import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/require-user";
import { getUserSettings } from "@/lib/services/settings";
import { AppearancePicker } from "@/components/settings/appearance-picker";
import { SettingsSubheader } from "@/components/settings/settings-subheader";

export const metadata: Metadata = { title: "Appearance" };

export default async function AppearanceSettingsPage() {
  const user = await requireUser();
  const settings = await getUserSettings(user.id);

  return (
    <>
      <SettingsSubheader
        backHref="/settings"
        backLabel="Back to settings"
        title="Appearance"
        description="Choose how Tirvea looks."
      />

      <AppearancePicker initial={settings.appearance} />
    </>
  );
}
