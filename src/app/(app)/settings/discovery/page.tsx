import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { SettingsSubheader } from "@/components/settings/settings-subheader";
import { DiscoveryPreferencesForm } from "@/components/app/discovery-preferences-form";

export const metadata: Metadata = { title: "Discovery preferences" };

export default async function DiscoverySettingsPage() {
  const user = await requireUser();
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
    select: {
      interestedIn: true,
      minAge: true,
      maxAge: true,
      maxDistanceKm: true,
      isVisible: true,
    },
  });
  if (!profile) redirect("/onboarding");

  return (
    <>
      <SettingsSubheader
        backHref="/settings"
        backLabel="Back to settings"
        title="Discovery"
        description="Tune who you see and who sees you."
      />
      <DiscoveryPreferencesForm initial={profile} />
    </>
  );
}
