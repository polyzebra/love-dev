import { getUserSettings } from "@/lib/services/settings";
import { ThemeSync } from "@/components/theme/theme-sync";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { AppNav } from "@/components/app/app-nav";
import { Aurora } from "@/components/fx/aurora";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Central guard: Supabase session + auth user + app user + status
  const user = await requireUser();
  const settings = await getUserSettings(user.id);
  if (!user.onboardingDone) redirect("/onboarding");

  return (
    <div className="noise relative min-h-dvh overflow-x-clip bg-background">
      <Aurora fixed intensity="faint" />
      <AppNav />
      <main className="relative mx-auto max-w-2xl px-4 pb-32 pt-6 md:px-6 lg:ml-72 lg:max-w-4xl lg:pb-12 lg:pt-10">
        <ThemeSync appearance={settings.appearance} />
        {children}
      </main>
    </div>
  );
}
