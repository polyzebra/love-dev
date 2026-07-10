import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/require-user";
import { getUserSettings } from "@/lib/services/settings";
import { SettingsNote } from "@/components/settings/settings-note";
import { SettingsSubheader } from "@/components/settings/settings-subheader";
import { SettingsToggleList } from "@/components/settings/settings-toggle-list";

export const metadata: Metadata = { title: "SMS notifications" };

export default async function SmsNotificationsPage() {
  const user = await requireUser();
  const settings = await getUserSettings(user.id);

  return (
    <>
      <SettingsSubheader
        backHref="/settings/notifications"
        backLabel="Back to notifications"
        title="SMS"
        description="Choose what reaches you by text."
      />

      <SettingsToggleList
        initial={settings}
        items={[
          {
            field: "smsEnabled",
            label: "Text alerts",
            hint: "Receive important account and safety alerts by text.",
          },
        ]}
      />

      <SettingsNote>
        Text delivery will activate when SMS is rolled out in your region.
      </SettingsNote>
    </>
  );
}
