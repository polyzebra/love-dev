import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppNav } from "@/components/app/app-nav";
import { Aurora } from "@/components/fx/aurora";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { onboardingDone: true, status: true },
  });
  if (!user || user.status === "DELETED") redirect("/login");
  if (!user.onboardingDone) redirect("/onboarding");

  return (
    <div className="noise relative min-h-dvh bg-background">
      <Aurora fixed intensity="faint" />
      <AppNav />
      <main className="relative mx-auto max-w-2xl px-4 pb-32 pt-6 md:px-6 lg:ml-72 lg:max-w-4xl lg:pb-12 lg:pt-10">
        {children}
      </main>
    </div>
  );
}
