import { getUserSettings } from "@/lib/services/settings";
import { deriveVerificationUxState } from "@/lib/services/photo-verification";
import { VerificationNotifier } from "@/components/app/verification-notifier";
import { ThemeSync } from "@/components/theme/theme-sync";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { isStaff } from "@/lib/rbac";
import { db } from "@/lib/db";
import { AppNav } from "@/components/app/app-nav";
import { Aurora } from "@/components/fx/aurora";
import { ServiceWorkerMount } from "@/components/app/service-worker-mount";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Central guard: Supabase session + auth user + app user + status
  const user = await requireUser();
  const settings = await getUserSettings(user.id);
  if (!user.onboardingDone) redirect("/onboarding");

  // Canonical verification state for the global banner/toasts - ONE read
  // through the existing accessor; the client component never fetches or
  // polls (docs: lib/verification-notice.ts). Background reconciliation
  // (profile/settings loads) keeps this fresh through the same rows.
  const verificationRow = await db.user.findUnique({
    where: { id: user.id },
    select: {
      photoVerifiedAt: true,
      verifications: {
        where: { type: "PHOTO" },
        select: { status: true, providerSessionId: true, reviewNote: true },
        take: 1,
      },
    },
  });
  const photoRow = verificationRow?.verifications[0] ?? null;
  const verificationUx = verificationRow
    ? deriveVerificationUxState({
        photoVerifiedAt: verificationRow.photoVerifiedAt,
        verification: photoRow,
      })
    : null;

  return (
    <div className="noise bg-background relative min-h-dvh overflow-x-clip">
      <Aurora fixed intensity="faint" />
      <ServiceWorkerMount />
      {/* Staff flag rides the session user already loaded by requireUser()
          (auth() selects role) - no extra DB query. Server decides; the
          boolean prop is stable so there is no hydration mismatch. */}
      <AppNav showAdmin={isStaff(user.role)} />
      <main className="relative mx-auto max-w-2xl px-4 pt-6 pb-32 md:px-6 lg:ml-72 lg:max-w-4xl lg:pt-10 lg:pb-12">
        <ThemeSync appearance={settings.appearance} />
        <VerificationNotifier
          state={verificationUx}
          sessionId={photoRow?.providerSessionId ?? null}
        />
        {children}
      </main>
    </div>
  );
}
