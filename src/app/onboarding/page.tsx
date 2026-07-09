import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { Logo } from "@/components/shared/logo";

export const metadata: Metadata = { title: "Create your profile" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireUser({ allow: "/onboarding" });

  const record = await db.user.findUnique({
    where: { id: user.id },
    select: { onboardingDone: true, name: true },
  });
  if (record?.onboardingDone) redirect("/discover");

  return (
    <div className="min-h-dvh bg-background">
      <header className="safe-top mx-auto w-full max-w-2xl px-5 py-5">
        <Logo />
      </header>
      <main className="mx-auto max-w-2xl px-5 pb-24">
        <OnboardingWizard initialName={record?.name ?? ""} />
      </main>
    </div>
  );
}
