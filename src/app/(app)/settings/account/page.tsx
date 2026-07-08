import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, CircleDashed } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Account & verification" };
export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const viewer = await requireUser();
  const user = await db.user.findUnique({
    where: { id: viewer.id },
    select: {
      email: true,
      emailVerified: true,
      phone: true,
      phoneVerified: true,
      verifications: { select: { type: true, status: true } },
    },
  });

  const photoVerification = user?.verifications.find((v) => v.type === "PHOTO");
  const idVerification = user?.verifications.find((v) => v.type === "IDENTITY");

  const rows = [
    {
      label: "Email",
      value: user?.email ?? "-",
      verified: !!user?.emailVerified,
      action: user?.emailVerified ? null : "Resend link",
    },
    {
      label: "Phone",
      value: user?.phone ?? "Not added",
      verified: !!user?.phoneVerified,
      action: user?.phone ? null : "Add phone",
    },
    {
      label: "Photo verification",
      value:
        photoVerification?.status === "APPROVED"
          ? "Verified"
          : photoVerification?.status === "IN_REVIEW"
            ? "In review"
            : "Not verified",
      verified: photoVerification?.status === "APPROVED",
      action: photoVerification?.status === "APPROVED" ? null : "Start",
    },
    {
      label: "ID verification (optional)",
      value: idVerification?.status === "APPROVED" ? "Verified" : "Not verified",
      verified: idVerification?.status === "APPROVED",
      action: idVerification?.status === "APPROVED" ? null : "Start",
    },
  ];

  return (
    <>
      <PageHeader title="Account" description="Identity, verification and sign-in." />

      {/* Trust score - real verification state, never faked */}
      {(() => {
        const score =
          (user?.emailVerified ? 25 : 0) +
          (user?.phoneVerified ? 25 : 0) +
          (photoVerification?.status === "APPROVED" ? 35 : 0) +
          (idVerification?.status === "APPROVED" ? 15 : 0);
        const nextStep = !user?.phoneVerified
          ? "Add phone verification to build trust with matches."
          : photoVerification?.status !== "APPROVED"
            ? "Photo verification increases profile trust the most."
            : idVerification?.status !== "APPROVED"
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
                <p>Email +25 · Phone +25</p>
                <p>Photo +35 · ID +15</p>
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
