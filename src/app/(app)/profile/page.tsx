import { GOAL_LINES } from "@/lib/discovery/taxonomy";
import { ProfileSectionCard } from "@/components/profile/profile-section-card";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Briefcase,
  ChevronDown,
  GraduationCap,
  Languages,
  MessageSquareQuote,
  PenLine,
  Ruler,
} from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { toVerificationState, VERIFICATION_USER_SELECT } from "@/lib/services/verification";
import {
  deriveVerificationUxState,
  isPhotoVerificationConfigured,
  maybeReconcilePhotoVerification,
} from "@/lib/services/photo-verification";
import { promptLabel } from "@/config/prompts";
import { calculateAge, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PhotoManager } from "@/components/profile/photo-manager";
import { PhotoVerifyCard } from "@/components/profile/photo-verify-card";
import {
  photoVerificationRow,
  VerificationStatusRow,
} from "@/components/shared/verification-status-row";
import { Reveal, RevealGroup, RevealItem } from "@/components/fx/reveal";
import { deriveVerificationPresentation } from "@/lib/verification-presentation";

export const metadata: Metadata = { title: "Profile" };

const GOAL_LABELS: Record<string, string> = GOAL_LINES;

export default async function ProfilePage() {
  const user = await requireUser();
  // Webhook-loss recovery: if this user's verification is PENDING and
  // stale, poll the provider once (atomic throttle) BEFORE any read, so
  // a completed hosted flow shows its badge on THIS render.
  await maybeReconcilePhotoVerification(user.id);
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
    include: {
      interests: { include: { interest: true } },
      prompts: { orderBy: { sortOrder: "asc" } },
      user: {
        select: {
          ...VERIFICATION_USER_SELECT,
          photos: { orderBy: [{ isCover: "desc" }, { position: "asc" }] },
        },
      },
    },
  });
  if (!profile) redirect("/onboarding");

  // Canonical verification verdicts - same accessor the account page,
  // admin trust panel and badges read. Never derive from Verification
  // rows directly (EMAIL/PHONE rows do not exist).
  const verification = toVerificationState(profile.user);
  // Full UX state for the verification flow card (workflow row fields the
  // shared select doesn't carry: providerSessionId + reviewNote).
  const photoWorkflow = await db.verification.findUnique({
    where: { userId_type: { userId: user.id, type: "PHOTO" } },
    select: { status: true, providerSessionId: true, reviewNote: true },
  });
  const verificationUx = deriveVerificationUxState({
    photoVerifiedAt: profile.user.photoVerifiedAt,
    faceBadgeSuspendedAt: profile.user.faceBadgeSuspendedAt,
    verification: photoWorkflow,
  });
  const verificationConfigured = isPhotoVerificationConfigured();
  // Face layer (profile-photo verification): one unique-row read; null
  // while the layer is dormant. Refines the presentation for VERIFIED
  // users (checking photos / photo update / action required).
  // Load the face job whenever IDENTITY is verified (badge live OR withheld
  // pending re-verification) - not only when the badge is currently live -
  // so the re-verify card renders while the badge is suspended.
  const faceJob =
    profile.user.photoVerifiedAt !== null
      ? await db.profilePhotoVerification.findUnique({
          where: { userId: user.id },
          select: { status: true, lastRunAt: true },
        })
      : null;
  const facePresentation = deriveVerificationPresentation(verificationUx, faceJob, {
    workflowStatus: photoWorkflow?.status ?? null,
  });
  // With identity verified, the presentation is one of: verified /
  // checking_profile_photos / photo_update_review / manual_review /
  // action_required - the guard narrows the type for the card prop.
  const FACE_CARD_STATES = [
    "checking_profile_photos",
    "photo_update_review",
    "action_required",
    "manual_review",
  ] as const;
  type FaceCardState = (typeof FACE_CARD_STATES)[number];
  const faceCardState: FaceCardState | null =
    (verification.photoVerified || verification.requiresReverification) &&
    verificationConfigured &&
    (FACE_CARD_STATES as readonly string[]).includes(facePresentation)
      ? (facePresentation as FaceCardState)
      : null;
  const photos = profile.user.photos;
  const age = calculateAge(profile.birthDate);
  const prompts = profile.prompts;

  const basics = [
    profile.heightCm && { icon: Ruler, label: `${profile.heightCm} cm` },
    profile.occupation && { icon: Briefcase, label: profile.occupation },
    profile.education && {
      icon: GraduationCap,
      label: profile.education.toLowerCase().replace(/_/g, " "),
    },
    profile.languages.length > 0 && { icon: Languages, label: profile.languages.join(", ") },
  ].filter(Boolean) as { icon: typeof Ruler; label: string }[];

  return (
    <div className="space-y-6">
      {/* ============ COVER + GALLERY - client-managed photos ============ */}
      <PhotoManager
        initialPhotos={photos}
        completionPct={profile.completionPct}
        displayName={profile.displayName}
        age={age}
        city={profile.city}
        country={profile.country}
        goalLabel={GOAL_LABELS[profile.relationshipGoal]}
        photoVerified={verification.photoVerified}
        gradientSeed={profile.userId}
      >
        {/* ================= TRUST ================= */}
        <RevealGroup className="grid gap-2.5 sm:grid-cols-3">
          {[
            // Email/phone are boolean verdicts (no workflow states);
            // their flows live in the account settings hub.
            ["email", "Email verified", verification.emailVerified] as const,
            ["phone", "Phone verified", verification.phoneVerified] as const,
          ].map(([type, label, done]) => {
            return (
              <RevealItem key={type}>
                <VerificationStatusRow
                  label={label}
                  state={done ? "verified" : "todo"}
                  action={done ? null : { label: "Verify", href: "/settings/account" }}
                />
              </RevealItem>
            );
          })}
          {/* Photo has a full workflow: this row reads the SAME canonical
              UX state as the PhotoVerifyCard below (one mapper - the row
              and the card can never disagree). */}
          <RevealItem>
            <VerificationStatusRow
              {...photoVerificationRow(verificationUx, {
                configured: verificationConfigured,
                surface: "profile",
              })}
            />
          </RevealItem>
        </RevealGroup>

        {/* Photo verification nudge - only while unverified AND a provider
            is configured. Unconfigured environments keep just the compact
            "Coming soon" status row above (one unavailable message, no dead
            CTA). Selfie capture happens on the provider's side; no
            biometrics are ever stored. */}
        {((!verification.photoVerified && verificationConfigured) || faceCardState) && (
          <Reveal>
            <PhotoVerifyCard
              state={verificationUx}
              workflowStatus={photoWorkflow?.status ?? null}
              facePresentation={faceCardState}
            />
          </Reveal>
        )}
      </PhotoManager>

      {/* ================= IN THEIR WORDS ================= */}
      {profile.bio ? (
        <Reveal>
          {/* Editorial by design - the bio is the emotional centre of the
              profile and reads as a personal story, never a settings card
              (no glass, no border, no shadow). Every other module keeps
              ProfileSectionCard. */}
          <section className="px-2 py-4 md:px-6">
            <div className="flex items-baseline justify-between">
              <p className="text-gold text-xs font-semibold tracking-[0.3em] uppercase">
                In my words
              </p>
              <Link
                href="/profile/bio"
                className="text-muted-foreground hover:text-foreground text-xs font-medium underline-offset-2 transition-colors hover:underline"
              >
                Edit
              </Link>
            </div>
            <blockquote className="font-display text-foreground/95 mt-3 text-2xl leading-snug whitespace-pre-wrap italic md:text-3xl">
              &ldquo;{profile.bio}&rdquo;
            </blockquote>
          </section>
        </Reveal>
      ) : (
        <Reveal>
          <ProfileSectionCard className="text-center">
            <p className="text-muted-foreground text-sm">
              No bio yet - profiles with a story get far more matches.{" "}
              <Link
                href="/profile/bio"
                className="text-primary-soft font-medium underline-offset-2 hover:underline"
              >
                Write yours
              </Link>
            </p>
          </ProfileSectionCard>
        </Reveal>
      )}

      {/* ================= YOUR PROMPTS - editorial Q&A ================= */}
      {prompts.length > 0 && (
        <Reveal>
          <ProfileSectionCard className="md:p-8">
            <div className="mb-5 flex items-baseline justify-between">
              <p className="text-gold text-xs font-semibold tracking-[0.3em] uppercase">
                Your prompts
              </p>
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
                <Link href="/profile/prompts">
                  <PenLine className="size-3.5" aria-hidden="true" />
                  Edit
                </Link>
              </Button>
            </div>
            <div className="space-y-6">
              {prompts.map((p) => (
                <div key={p.promptKey}>
                  <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.2em] uppercase">
                    {promptLabel(p.promptKey)}
                  </p>
                  <p className="font-display text-foreground/95 mt-1.5 text-xl leading-snug md:text-2xl">
                    {p.answer}
                  </p>
                </div>
              ))}
            </div>
          </ProfileSectionCard>
        </Reveal>
      )}
      {prompts.length < 3 && (
        <Reveal>
          <section className="glass border-foreground/15 flex flex-col items-center gap-3 rounded-xl border border-dashed p-7 text-center">
            <span className="glass-chip flex size-12 items-center justify-center rounded-full">
              <MessageSquareQuote className="text-gold size-5" aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <p className="font-display text-xl font-medium tracking-tight">
                {prompts.length === 0 ? "Add your first prompt" : "Answer a few more prompts"}
              </p>
              <p className="text-muted-foreground max-w-sm text-sm">
                Your answers become conversation starters - people reply to your words, not your
                stats.
              </p>
            </div>
            <Button className="mt-1 rounded-full px-6" asChild>
              <Link href="/profile/prompts">Answer prompts</Link>
            </Button>
          </section>
        </Reveal>
      )}

      {/* ================= INTEREST CLOUD ================= */}
      {profile.interests.length > 0 && (
        <Reveal>
          <section className="glass rounded-xl p-6">
            <p className="text-gold mb-4 text-xs font-semibold tracking-[0.3em] uppercase">Into</p>
            <div className="flex flex-wrap items-center gap-2">
              {profile.interests.map(({ interest }, i) => (
                <span
                  key={interest.id}
                  className={cn(
                    "border-border bg-foreground/5 rounded-full border font-medium",
                    i % 3 === 0 ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-xs",
                    i % 4 === 0 && "bg-primary/12 text-primary-soft",
                  )}
                >
                  {interest.label}
                </span>
              ))}
            </div>
          </section>
        </Reveal>
      )}

      {/* ================= THE BASICS - demoted, collapsed ================= */}
      {basics.length > 0 && (
        <Reveal>
          <details className="group border-border bg-card/40 rounded-xl border">
            <summary className="text-muted-foreground flex cursor-pointer list-none items-center justify-between px-6 py-4 text-xs font-semibold tracking-[0.3em] uppercase [&::-webkit-details-marker]:hidden">
              The basics
              <ChevronDown
                className="size-4 transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="grid gap-2.5 px-6 pb-5 sm:grid-cols-2">
              {basics.map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="text-muted-foreground flex items-center gap-2.5 text-sm"
                >
                  <Icon className="size-4 shrink-0 opacity-60" aria-hidden="true" />
                  <span className="truncate capitalize">{label}</span>
                </div>
              ))}
            </div>
          </details>
        </Reveal>
      )}
    </div>
  );
}
