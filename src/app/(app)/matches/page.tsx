import type { Metadata } from "next";
import Link from "next/link";
import { HeartOff } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { calculateAge, initialsOf } from "@/lib/utils";
import { isOnline } from "@/lib/presence";
import { listFirstMessagesFor } from "@/lib/services/first-messages";
import {
  GOAL_LINES,
  categoriesForProfile,
  pickTemplate,
} from "@/lib/discovery/taxonomy";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { OnlineDot } from "@/components/shared/online-dot";
import { PhotoFrame, type FramePhoto } from "@/components/shared/photo-frame";
import {
  FirstMessageInbox,
  type FirstMessageCardData,
} from "@/components/app/first-message-inbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { RelationshipGoal } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Matches" };

/**
 * Contract with src/lib/services/first-messages.ts:
 * listFirstMessagesFor(receiverId) resolves PENDING first messages with
 * the sender's profile - displayName, age, city, first photo,
 * relationshipGoal and the structured tags/interests the taxonomy reads.
 */
type PendingFirstMessage = {
  id: string;
  body: string;
  sender: {
    userId: string;
    displayName: string;
    age: number | null;
    city: string | null;
    photo: FramePhoto | null;
    relationshipGoal: RelationshipGoal | null;
    availabilityTags: string[];
    communityTags: string[];
    interestSlugs: string[];
  };
};

type TaxonomyFields = {
  relationshipGoal: RelationshipGoal | null;
  availabilityTags: string[];
  communityTags: string[];
  interestSlugs: string[];
};

/**
 * ONE real line for the card: the strongest taxonomy category the viewer
 * and the sender actually share, phrased by its matchReasonTemplates
 * (stable pick per pair). No overlap -> the sender's own goal line.
 * Never invented.
 */
function sharedReasonLine(
  viewer: TaxonomyFields | null,
  sender: PendingFirstMessage["sender"],
): string {
  if (viewer) {
    const viewerIds = new Set(categoriesForProfile(viewer).map((c) => c.id));
    const strongest = categoriesForProfile({
      relationshipGoal: sender.relationshipGoal,
      availabilityTags: sender.availabilityTags ?? [],
      communityTags: sender.communityTags ?? [],
      interestSlugs: sender.interestSlugs ?? [],
    })
      .filter((c) => viewerIds.has(c.id))
      .sort((a, b) => b.scoringWeight - a.scoringWeight)[0];
    if (strongest) {
      return pickTemplate(strongest.matchReasonTemplates, `${sender.userId}:${strongest.id}`);
    }
  }
  return GOAL_LINES[sender.relationshipGoal ?? "FIGURING_OUT"];
}

/** One-line preview: collapsed whitespace, hard cap ~90 chars. */
function previewOf(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 90 ? `${t.slice(0, 89).trimEnd()}…` : t;
}

export default async function MatchesPage() {
  const user = await requireUser();
  const userId = user.id;

  // Three independent reads - one parallel batch, no waterfall.
  const [pendingRaw, viewerProfile, matches] = await Promise.all([
    listFirstMessagesFor(userId),
    db.profile.findUnique({
      where: { userId },
      select: {
        relationshipGoal: true,
        availabilityTags: true,
        communityTags: true,
        interests: { select: { interest: { select: { slug: true } } } },
      },
    }),
    db.match.findMany({
      where: { status: "ACTIVE", OR: [{ userAId: userId }, { userBId: userId }] },
      include: {
        conversation: { select: { id: true, lastMessageAt: true } },
        userA: {
          select: {
            id: true,
            lastActiveAt: true,
            profile: { select: { displayName: true, birthDate: true, city: true } },
            photos: { orderBy: [{ isCover: "desc" }, { position: "asc" }], take: 1, select: { url: true, galleryUrl: true, blurDataUrl: true } },
          },
        },
        userB: {
          select: {
            id: true,
            lastActiveAt: true,
            profile: { select: { displayName: true, birthDate: true, city: true } },
            photos: { orderBy: [{ isCover: "desc" }, { position: "asc" }], take: 1, select: { url: true, galleryUrl: true, blurDataUrl: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const pending = pendingRaw as PendingFirstMessage[];
  const viewer: TaxonomyFields | null = viewerProfile
    ? {
        relationshipGoal: viewerProfile.relationshipGoal,
        availabilityTags: viewerProfile.availabilityTags,
        communityTags: viewerProfile.communityTags,
        interestSlugs: viewerProfile.interests.map(
          (i: { interest: { slug: string } }) => i.interest.slug,
        ),
      }
    : null;

  const inboxCards: FirstMessageCardData[] = pending.map((m) => ({
    id: m.id,
    senderName: m.sender.displayName,
    senderAge: m.sender.age,
    senderCity: m.sender.city,
    photo: m.sender.photo,
    preview: previewOf(m.body),
    reason: sharedReasonLine(viewer, m.sender),
  }));
  // Only mounted when there is at least one - never an empty section.
  const inbox = inboxCards.length > 0 ? <FirstMessageInbox initialItems={inboxCards} /> : null;

  if (matches.length === 0) {
    return (
      <>
        <PageHeader title="Matches" description="People who liked you back." />
        {inbox}
        <EmptyState
          icon={HeartOff}
          title="No matches yet"
          description="Your future match is probably in Discover right now. Keep an open mind - and a complete profile makes it easier for the right people to find you."
          action={
            <Button className="rounded-full" asChild>
              <Link href="/discover">Go to Discover</Link>
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Matches"
        description={`${matches.length} ${matches.length === 1 ? "person" : "people"} liked you back.`}
      />
      {inbox}
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {matches.map((m) => {
          const other = m.userAId === userId ? m.userB : m.userA;
          const name = other.profile?.displayName ?? "Member";
          const age = other.profile ? calculateAge(other.profile.birthDate) : null;
          const online = isOnline(other.lastActiveAt);
          const isNew = !m.conversation?.lastMessageAt;

          return (
            <li key={m.id}>
              <Link
                href={m.conversation ? `/chat/${m.conversation.id}` : "/chat"}
                className="group block overflow-hidden rounded-3xl border bg-card shadow-card transition-shadow hover:shadow-float"
              >
                <PhotoFrame
                  photo={other.photos[0] ?? null}
                  alt={`${name}'s photo`}
                  variant="gallery"
                  loading="lazy"
                  radius="none"
                  className="bg-muted"
                  imgClassName="transition-[opacity,filter,transform] duration-300 group-hover:scale-[1.03]"
                  fallback={
                    <div className="flex h-full items-center justify-center">
                      <Avatar className="size-16">
                        <AvatarImage src={undefined} alt="" />
                        <AvatarFallback className="text-xl">{initialsOf(name)}</AvatarFallback>
                      </Avatar>
                    </div>
                  }
                >
                  {isNew && (
                    <span className="absolute left-3 top-3 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
                      New match
                    </span>
                  )}
                </PhotoFrame>
                <div className="flex items-center gap-2 p-3">
                  <p className="truncate text-sm font-medium" title={age ? `${name}, ${age}` : name}>
                    {name}
                    {age ? `, ${age}` : ""}
                  </p>
                  <OnlineDot online={online} className="shrink-0" />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
