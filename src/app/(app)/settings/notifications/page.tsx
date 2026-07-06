import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { NotificationPreferences } from "@/components/app/notification-preferences";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationSettingsPage() {
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Choose what reaches you. Changes apply instantly."
      />
      <NotificationPreferences />
    </>
  );
}
