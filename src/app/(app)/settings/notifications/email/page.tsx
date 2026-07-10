import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/require-user";
import { getUserSettings } from "@/lib/services/settings";
import { SettingsSubheader } from "@/components/settings/settings-subheader";
import { SettingsToggleList } from "@/components/settings/settings-toggle-list";

export const metadata: Metadata = { title: "Email notifications" };

export default async function EmailNotificationsPage() {
  const user = await requireUser();
  const settings = await getUserSettings(user.id);

  return (
    <>
      <SettingsSubheader
        backHref="/settings/notifications"
        backLabel="Back to notifications"
        title="Email"
        description="Choose which emails help you stay connected."
      />

      <SettingsToggleList
        initial={settings}
        items={[
          {
            field: "emailNewMatches",
            label: "New matches",
            hint: "When you and someone like each other.",
          },
          {
            field: "emailMessages",
            label: "Messages",
            hint: "New messages from your matches.",
          },
          {
            field: "emailPromotions",
            label: "Promotions",
            hint: "Product updates and occasional offers.",
          },
        ]}
      />
    </>
  );
}
