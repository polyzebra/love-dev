import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  Briefcase,
  Camera,
  GraduationCap,
  Languages,
  MapPin,
  PencilLine,
  Ruler,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { calculateAge } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { VerifiedBadge } from "@/components/shared/verified-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

const GOAL_LABELS: Record<string, string> = {
  LONG_TERM: "Long-term relationship",
  SHORT_TERM: "Something casual",
  OPEN_TO_EITHER: "Open to either",
  FRIENDSHIP: "Friendship",
  FIGURING_OUT: "Still figuring it out",
};

export default async function ProfilePage() {
  const session = await auth();
  const profile = await db.profile.findUnique({
    where: { userId: session!.user.id },
    include: {
      interests: { include: { interest: true } },
      user: {
        select: {
          photos: { orderBy: [{ isCover: "desc" }, { position: "asc" }] },
          verifications: { where: { status: "APPROVED" }, select: { type: true } },
        },
      },
    },
  });
  if (!profile) redirect("/onboarding");

  const verifiedTypes = new Set(profile.user.verifications.map((v) => v.type));
  const photos = profile.user.photos;

  return (
    <>
      <PageHeader
        title="Profile"
        description="This is what potential matches see."
        actions={
          <Button className="rounded-full" asChild>
            <Link href="/settings">
              <PencilLine className="size-4" /> Edit
            </Link>
          </Button>
        }
      />

      {/* Completion nudge */}
      {profile.completionPct < 100 && (
        <Card className="mb-6 rounded-3xl border-primary/20 bg-accent/60">
          <CardContent className="space-y-3 py-5">
            <div className="flex items-center justify-between text-sm">
              <p className="font-medium text-accent-foreground">
                Profile {profile.completionPct}% complete
              </p>
              <p className="text-muted-foreground">Complete profiles get up to 3× more likes</p>
            </div>
            <Progress value={profile.completionPct} aria-label={`Profile ${profile.completionPct}% complete`} />
          </CardContent>
        </Card>
      )}

      {/* Photos */}
      <section aria-labelledby="photos-heading" className="mb-8">
        <h2 id="photos-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Photos ({photos.length}/9)
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {photos.map((photo, i) => (
            <div key={photo.id} className="relative aspect-3/4 overflow-hidden rounded-2xl bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
              {photo.isCover && (
                <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
                  Cover
                </span>
              )}
            </div>
          ))}
          {photos.length < 9 && (
            <button
              type="button"
              className="flex aspect-3/4 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              aria-label="Add photo"
            >
              <Camera className="size-6" aria-hidden="true" />
              <span className="text-xs font-medium">Add photo</span>
            </button>
          )}
        </div>
        {photos.length < 2 && (
          <p className="mt-2 text-xs text-warning-foreground">
            Add at least 2 photos to appear in Discover.
          </p>
        )}
      </section>

      {/* About */}
      <Card className="mb-6 rounded-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            {profile.displayName}, {calculateAge(profile.birthDate)}
            {verifiedTypes.has("PHOTO") && <VerifiedBadge />}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {profile.bio ? (
            <p className="leading-relaxed">{profile.bio}</p>
          ) : (
            <p className="text-sm italic text-muted-foreground">
              No bio yet — profiles with a bio get far more matches.
            </p>
          )}
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <MapPin className="size-4 text-muted-foreground" aria-hidden="true" />
              <dt className="sr-only">Location</dt>
              <dd>
                {profile.city}
                {profile.country === "IE" ? ", Ireland" : ", UK"}
              </dd>
            </div>
            {profile.heightCm && (
              <div className="flex items-center gap-2">
                <Ruler className="size-4 text-muted-foreground" aria-hidden="true" />
                <dt className="sr-only">Height</dt>
                <dd>{profile.heightCm} cm</dd>
              </div>
            )}
            {profile.occupation && (
              <div className="flex items-center gap-2">
                <Briefcase className="size-4 text-muted-foreground" aria-hidden="true" />
                <dt className="sr-only">Occupation</dt>
                <dd>{profile.occupation}</dd>
              </div>
            )}
            {profile.education && (
              <div className="flex items-center gap-2">
                <GraduationCap className="size-4 text-muted-foreground" aria-hidden="true" />
                <dt className="sr-only">Education</dt>
                <dd className="capitalize">{profile.education.toLowerCase().replace(/_/g, " ")}</dd>
              </div>
            )}
            {profile.languages.length > 0 && (
              <div className="flex items-center gap-2">
                <Languages className="size-4 text-muted-foreground" aria-hidden="true" />
                <dt className="sr-only">Languages</dt>
                <dd>{profile.languages.join(", ")}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Looking for + interests */}
      <Card className="mb-6 rounded-3xl">
        <CardHeader>
          <CardTitle className="text-base">Looking for</CardTitle>
        </CardHeader>
        <CardContent>
          <Badge variant="secondary" className="rounded-full px-4 py-1.5">
            {GOAL_LABELS[profile.relationshipGoal]}
          </Badge>
        </CardContent>
      </Card>

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-base">Interests</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {profile.interests.map(({ interest }) => (
            <Badge key={interest.id} variant="outline" className="rounded-full px-3.5 py-1">
              {interest.label}
            </Badge>
          ))}
        </CardContent>
      </Card>

      {/* Verification statuses */}
      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        {(
          [
            ["EMAIL", "Email verified"],
            ["PHONE", "Phone verified"],
            ["PHOTO", "Photo verified"],
          ] as const
        ).map(([type, label]) => {
          const done = verifiedTypes.has(type);
          return (
            <div
              key={type}
              className="flex items-center gap-2 rounded-2xl border bg-card px-4 py-3 text-sm"
            >
              <BadgeCheck
                className={done ? "size-5 text-success" : "size-5 text-muted-foreground/40"}
                aria-hidden="true"
              />
              <span className={done ? "" : "text-muted-foreground"}>{label}</span>
              {!done && (
                <Button variant="link" size="sm" className="ml-auto h-auto p-0 text-primary" asChild>
                  <Link href="/settings/account">Verify</Link>
                </Button>
              )}
            </div>
          );
        })}
      </section>
    </>
  );
}
