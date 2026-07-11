import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, CircleDashed } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import {
  toVerificationState,
  TRUST_WEIGHTS,
  VERIFICATION_USER_SELECT,
} from "@/lib/services/verification";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Account & verification" };

export default async function AccountSettingsPage() {
  const viewer = await requireUser();
  const user = await db.user.findUnique({
    where: { id: viewer.id },
    // phoneE164 is the canonical phone column (User.phone is write-only
    // legacy); verification verdicts come from the shared accessor.
    select: {
      email: true,
      phoneE164: true,
      ...VERIFICATION_USER_SELECT,
    },
  });

  // Canonical verification state - same accessor the profile hero,
  // admin trust panel and badges read.
  const verification = user ? toVerificationState(user) : null;

  const rows = [
    {
      label: "Email",
      value: user?.email ?? "-",
      verified: !!verification?.emailVerified,
      action: verification?.emailVerified ? null : "Resend link",
    },
    {
      label: "Phone",
      value: user?.phoneE164 ?? "Not added",
      verified: !!verification?.phoneVerified,
      action: user?.phoneE164 ? null : "Add phone",
    },
    {
      label: "Photo verification",
      value: verification?.photoVerified
        ? "Verified"
        : verification?.photoStatus === "IN_REVIEW"
          ? "In review"
          : "Not verified",
      verified: !!verification?.photoVerified,
      action: verification?.photoVerified ? null : "Start",
    },
    {
      label: "ID verification (optional)",
      value: verification?.idVerified ? "Verified" : "Not verified",
      verified: !!verification?.idVerified,
      action: verification?.idVerified ? null : "Start",
    },
  ];

  return (
    <>
      <PageHeader title="Account" description="Identity, verification and sign-in." />

      {/* Trust score - real verification state, never faked */}
      {(() => {
        const score = verification?.trustScore ?? 0;
        const nextStep = !verification?.phoneVerified
          ? "Add phone verification to build trust with matches."
          : !verification.photoVerified
            ? "Photo verification increases profile trust the most."
            : !verification.idVerified
              ? "Optional ID verification completes your trust profile."
              : "Fully verified - matches can trust who they're meeting.";
        return (
          <section className="glass mb-6 rounded-[28px] p-6" aria-label={`Trust score ${score} percent`}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gold">Trust score</p>
                <p className="mt-1 font-display text-4xl font-medium tabular-nums">{score}%</p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">{nextStep}</p>
              </div>
              <div className="hidden text-right text-xs text-muted-foreground sm:block">
                <p>Email +{TRUST_WEIGHTS.email} · Phone +{TRUST_WEIGHTS.phone}</p>
                <p>Photo +{TRUST_WEIGHTS.photo} · ID +{TRUST_WEIGHTS.id}</p>
              </div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full border border-border bg-foreground/10">
              <div className="h-full rounded-full bg-linear-90 from-[#fb4a6e] to-[#e7c9a1] shadow-[0_0_12px_rgba(225,29,72,0.4)] transition-[width] duration-700" style={{ width: `${score}%` }} />
            </div>
          </section>
        );
      })()}

      <Card className="mb-6 rounded-3xl">
        <CardHeader>
          <CardTitle className="text-base">Verification</CardTitle>
          <CardDescription>
            Verified members get more matches and a badge on their profile. Identity documents are
            handled by our verification partner and never stored by Tirvea.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center gap-3 py-3.5 first:pt-0 last:pb-0">
              {row.verified ? (
                <BadgeCheck className="size-5 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <CircleDashed className="size-5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{row.label}</p>
                <p className="truncate text-sm text-muted-foreground">{row.value}</p>
              </div>
              {row.action && (
                <Button variant="outline" size="sm" className="rounded-full">
                  {row.action}
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-base">Password</CardTitle>
          <CardDescription>
            Change or set your password via a secure email link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="rounded-full" asChild>
            <Link href="/forgot-password">
              Change password
            </Link>
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
