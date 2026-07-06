import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppNav } from "@/components/app/app-nav";

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
    <div className="min-h-dvh bg-background">
      <AppNav />
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-4 md:px-6 lg:ml-64 lg:max-w-4xl lg:pb-10 lg:pt-8">
        {children}
      </main>
    </div>
  );
}
