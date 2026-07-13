import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, CircleAlert, CircleDashed, Hourglass, type LucideIcon } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import {
  toVerificationState,
  TRUST_WEIGHTS,
  VERIFICATION_USER_SELECT,
} from "@/lib/services/verification";
import { SettingsSubheader } from "@/components/settings/settings-subheader";
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

  // Four visual registers, never color-only: each pairs an icon with the
  // state text (verified / pending / needs another try / not available).
  type RowState = "verified" | "pending" | "needs-action" | "todo" | "unavailable";
  type Row = {
    label: string;
    value: string;
    state: RowState;
    /** Real destination only - no dead buttons. */
    action: { label: string; href: string } | null;
  };

  // Workflow (not verdict) state for the photo row - PENDING/IN_REVIEW
  // must read as pending, REJECTED/EXPIRED as "try again". The verdict
  // itself stays canonical via toVerificationState.
  const photoState: RowState = verification?.photoVerified
    ? "verified"
    : verification?.photoStatus === "PENDING" || verification?.photoStatus === "IN_REVIEW"
      ? "pending"
      : verification?.photoStatus === "REJECTED" || verification?.photoStatus === "EXPIRED"
        ? "needs-action"
        : "todo";

  const rows: Row[] = [
    {
      label: "Email",
      value: user?.email ?? "-",
      state: verification?.emailVerified ? "verified" : "todo",
      // The authenticated attach+verify flow at /auth/email is the one
      // real way to (re)verify an address on this account.
      action: verification?.emailVerified ? null : { label: "Verify email", href: "/auth/email" },
    },
    {
      label: "Phone",
      value: user?.phoneE164 ?? "Not added",
      state: verification?.phoneVerified ? "verified" : "todo",
      action: verification?.phoneVerified ? null : { label: "Add phone", href: "/auth/phone" },
    },
    {
      label: "Photo verification",
      value:
        photoState === "verified"
          ? "Verified"
          : photoState === "pending"
            ? verification?.photoStatus === "IN_REVIEW"
              ? "In review"
              : "In progress"
            : photoState === "needs-action"
              ? "Didn't go through - try again"
              : "Not verified",
      state: photoState,
      // The verification flow card lives on the profile page.
      action:
        photoState === "verified"
          ? null
          : photoState === "pending"
            ? { label: "View status", href: "/profile" }
            : { label: photoState === "needs-action" ? "Try again" : "Start", href: "/profile" },
    },
    {
      label: "ID verification (optional)",
      value: verification?.idVerified ? "Verified" : "Not available yet",
      state: verification?.idVerified ? "verified" : "unavailable",
      // No user-facing ID flow exists yet - an honest quiet state beats
      // a dead "Start" button.
      action: null,
    },
  ];

  const STATE_ICON: Record<RowState, { icon: LucideIcon; className: string }> = {
    verified: { icon: BadgeCheck, className: "text-success" },
    pending: { icon: Hourglass, className: "text-gold" },
    "needs-action": { icon: CircleAlert, className: "text-muted-foreground" },
    todo: { icon: CircleDashed, className: "text-muted-foreground/50" },
    unavailable: { icon: CircleDashed, className: "text-muted-foreground/50" },
  };

  return (
    <>
      <SettingsSubheader
        backHref="/settings"
        backLabel="Back to settings"
        title="Account"
        description="Identity, verification and sign-in."
      />

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
          <section
            className="glass mb-6 rounded-xl p-6"
            aria-label={`Trust score ${score} percent`}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-gold text-xs font-semibold tracking-[0.3em] uppercase">
                  Trust score
                </p>
                <p className="font-display mt-1 text-4xl font-medium tabular-nums">{score}%</p>
                <p className="text-muted-foreground mt-1 max-w-sm text-sm">{nextStep}</p>
              </div>
              <div className="text-muted-foreground hidden text-right text-xs sm:block">
                <p>
                  Email +{TRUST_WEIGHTS.email} · Phone +{TRUST_WEIGHTS.phone}
                </p>
                <p>
                  Photo +{TRUST_WEIGHTS.photo} · ID +{TRUST_WEIGHTS.id}
                </p>
              </div>
            </div>
            <div className="border-border bg-foreground/10 mt-4 h-2 overflow-hidden rounded-full border">
              <div
                className="from-brand-bright h-full rounded-full bg-linear-90 to-[#e7c9a1] shadow-[0_0_12px_color-mix(in_srgb,var(--primary)_40%,transparent)] transition-[width] duration-700"
                style={{ width: `${score}%` }}
              />
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
          {rows.map((row) => {
            const { icon: Icon, className } = STATE_ICON[row.state];
            return (
              <div key={row.label} className="flex items-center gap-3 py-3.5 first:pt-0 last:pb-0">
                <Icon className={`size-5 shrink-0 ${className}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{row.label}</p>
                  <p className="text-muted-foreground truncate text-sm" title={row.value}>
                    {row.value}
                  </p>
                </div>
                {row.action && (
                  <Button variant="outline" className="h-11 shrink-0 rounded-full px-4" asChild>
                    <Link href={row.action.href}>{row.action.label}</Link>
                  </Button>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-base">Password</CardTitle>
          <CardDescription>Change or set your password via a secure email link.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="h-11 rounded-full px-5" asChild>
            <Link href="/forgot-password">Change password</Link>
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
