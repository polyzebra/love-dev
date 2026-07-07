import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { DiscoveryPreferencesForm } from "@/components/app/discovery-preferences-form";

export const metadata: Metadata = { title: "Discovery preferences" };
export const dynamic = "force-dynamic";

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
      <PageHeader title="Discovery" description="Tune who you see and who sees you." />
      <DiscoveryPreferencesForm initial={profile} />
    </>
  );
}
