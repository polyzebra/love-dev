import type { Metadata } from "next";

import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import {
  deriveVerificationUxState,
  isPhotoVerificationConfigured,
  maybeReconcilePhotoVerification,
} from "@/lib/services/photo-verification";
import {
  photoVerificationRow,
  VerificationStatusRow,
  type VerificationRowState,
} from "@/components/shared/verification-status-row";
import {
  toVerificationState,
  TRUST_WEIGHTS,
  VERIFICATION_USER_SELECT,
} from "@/lib/services/verification";
import { getFaceVerificationAction } from "@/lib/services/face-action";
import { SettingsSubheader } from "@/components/settings/settings-subheader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Account & verification" };

export default async function AccountSettingsPage() {
  const viewer = await requireUser();
  // Same webhook-loss recovery as the profile page - throttled shared
  // claim, so back-to-back visits never double-poll the provider.
  await maybeReconcilePhotoVerification(viewer.id);
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
  const photoConfigured = isPhotoVerificationConfigured();
  // THE canonical UX state - identical inputs to the profile page and
  // PhotoVerifyCard, so every surface renders the same verdict.
  const photoWorkflow = await db.verification.findUnique({
    where: { userId_type: { userId: viewer.id, type: "PHOTO" } },
    select: { status: true, providerSessionId: true, reviewNote: true },
  });
  const photoUx = deriveVerificationUxState({
    photoVerifiedAt: user?.photoVerifiedAt ?? null,
    faceBadgeSuspendedAt: user?.faceBadgeSuspendedAt ?? null,
    verification: photoWorkflow,
  });
  // L8.3.1: the SAME canonical face action the Profile surface resolves, so
  // the Account row can never disagree about first-time enrolment vs a photo
  // match. Load the per-user face row only once identity is verified.
  const faceJob = user?.photoVerifiedAt
    ? await db.profilePhotoVerification.findUnique({
        where: { userId: viewer.id },
        select: { status: true, consentAt: true },
      })
    : null;
  const faceAction = getFaceVerificationAction({
    identityVerified: user?.photoVerifiedAt != null,
    badgeSuspended: user?.faceBadgeSuspendedAt != null,
    faceJob,
  });
  const photoRow = photoVerificationRow(photoUx, {
    configured: photoConfigured,
    surface: "settings",
    faceAction,
  });
  // Public verdict date only (photoVerifiedAt) - internal workflow
  // timestamps (statusChangedAt / lastReconciledAt) never leave admin.
  const verifiedOn = verification?.photoVerifiedAt
    ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(
        verification.photoVerifiedAt,
      )
    : null;

  // Four visual registers, never color-only: each pairs an icon with the
  // state text (verified / pending / needs another try / not available).
  type RowState = VerificationRowState;
  type Row = {
    label: string;
    value: string;
    state: RowState;
    /** Real destination only - no dead buttons. */
    action: { label: string; href: string } | null;
  };

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
      // Canonical mapper output (shared with the profile row + card) -
      // no local switch, so the surfaces can never disagree. The public
      // verified date rides along.
      label: photoRow.label,
      value:
        photoUx === "verified" && verifiedOn
          ? `Verified ${verifiedOn}`
          : (photoRow.value ?? "Not verified"),
      state: photoRow.state,
      action: photoRow.action,
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
          {rows.map((row) => (
            <VerificationStatusRow
              key={row.label}
              variant="list"
              label={row.label}
              state={row.state}
              value={row.value}
              action={row.action}
            />
          ))}
        </CardContent>
      </Card>

    </>
  );
}
