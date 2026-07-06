import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { DiscoveryPreferencesForm } from "@/components/app/discovery-preferences-form";

export const metadata: Metadata = { title: "Discovery preferences" };
export const dynamic = "force-dynamic";

export default async function DiscoverySettingsPage() {
  const session = await auth();
  const profile = await db.profile.findUnique({
    where: { userId: session!.user.id },
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
