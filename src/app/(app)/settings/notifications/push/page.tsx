import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/require-user";
import { getUserSettings } from "@/lib/services/settings";
import { SettingsNote } from "@/components/settings/settings-note";
import { SettingsSubheader } from "@/components/settings/settings-subheader";
import { SettingsToggleList } from "@/components/settings/settings-toggle-list";

export const metadata: Metadata = { title: "Push notifications" };

export default async function PushNotificationsPage() {
  const user = await requireUser();
  const settings = await getUserSettings(user.id);

  return (
    <>
      <SettingsSubheader
        backHref="/settings/notifications"
        backLabel="Back to notifications"
        title="Push"
        description="Get notified when something worth your attention happens."
      />

      <SettingsToggleList
        initial={settings}
        items={[
          {
            field: "pushNewMatches",
            label: "New matches",
            hint: "The moment it's mutual.",
          },
          {
            field: "pushMessages",
            label: "Messages",
            hint: "New messages from your matches.",
          },
          {
            field: "pushMessageLikes",
            label: "Message likes",
            hint: "When someone likes a message you sent.",
          },
          {
            field: "pushSuperLikes",
            label: "Super Likes",
            hint: "When someone really wants to meet you.",
          },
          {
            field: "pushDailyPicks",
            label: "Daily Picks",
            hint: "A short daily selection, picked with reasons.",
          },
          {
            field: "pushOffers",
            label: "Offers",
            hint: "Occasional membership offers.",
          },
        ]}
      />

      <SettingsNote>
        Push delivery will activate when notifications are enabled on this device.
      </SettingsNote>
    </>
  );
}
