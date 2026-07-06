import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { Logo } from "@/components/shared/logo";

export const metadata: Metadata = { title: "Create your profile" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { onboardingDone: true, name: true },
  });
  if (user?.onboardingDone) redirect("/discover");

  return (
    <div className="min-h-dvh bg-background">
      <header className="safe-top mx-auto w-full max-w-2xl px-5 py-5">
        <Logo />
      </header>
      <main className="mx-auto max-w-2xl px-5 pb-24">
        <OnboardingWizard initialName={user?.name ?? ""} />
      </main>
    </div>
  );
}
