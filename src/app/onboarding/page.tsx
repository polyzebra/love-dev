import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export const metadata: Metadata = { title: "Create your profile" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireUser({ allow: "/onboarding" });

  const record = await db.user.findUnique({
    where: { id: user.id },
    select: { onboardingDone: true, name: true },
  });
  if (record?.onboardingDone) redirect("/discover");

  // The wizard owns the whole shell (logo, progress, content, CTA) so the
  // onboarding surface has a single spacing source of truth.
  return <OnboardingWizard initialName={record?.name ?? ""} />;
}
