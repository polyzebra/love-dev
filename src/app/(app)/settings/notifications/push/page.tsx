import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/require-user";
import { getUserSettings } from "@/lib/services/settings";
import { PushSetup } from "@/components/settings/push-setup";
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

      <PushSetup />

      <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        What reaches you
      </h2>
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
        Notifications delivered while the app is closed use your device&apos;s notification
        settings for sound and vibration - on iPhone and iPad the system settings always decide.
      </SettingsNote>
    </>
  );
}
