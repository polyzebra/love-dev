import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { VerifiedBadge } from "@/components/shared/verified-badge";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { assertParticipant, markRead, listThreadMessages } from "@/lib/services/chat";
import { ChatThread, type ThreadMessage } from "@/components/app/chat-thread";
import { ChatActions } from "@/components/app/chat-actions";
import { ProfilePeek } from "@/components/app/profile-peek";
import { OnlineDot } from "@/components/shared/online-dot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { calculateAge, initialsOf } from "@/lib/utils";
import { isOnline as presenceOnline } from "@/lib/presence";
import { promptLabel } from "@/config/prompts";
import { categoriesForProfile } from "@/lib/discovery/taxonomy";
import { isPubliclyVerified, PUBLIC_BADGE_SELECT } from "@/lib/services/verification";

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ suggest?: string | string[] }>;
}) {
  const [{ conversationId }, { suggest }] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const userId = user.id;

  // The participation check and the three reads are independent - run
  // them as one parallel batch and gate on the check before using any of
  // it. markRead stays AFTER the gate: its participant.update throws for
  // non-participants and its SEEN sweep must never run for outsiders.
  const [participant, other, myProfile, threadPage] = await Promise.all([
    assertParticipant(conversationId, userId),
    db.participant.findFirst({
      where: { conversationId, userId: { not: userId } },
      include: {
        user: {
          select: {
            id: true,
            lastActiveAt: true,
            profile: {
              select: {
                displayName: true,
                bio: true,
                birthDate: true,
                city: true,
                relationshipGoal: true,
                availabilityTags: true,
                communityTags: true,
                interests: { select: { interest: { select: { label: true, slug: true } } } },
                prompts: {
                  orderBy: { sortOrder: "asc" },
                  select: { promptKey: true, answer: true },
                },
              },
            },
            // H1: canonical public-badge projection (photoVerifiedAt +
            // faceVerifiedAt + faceBadgeSuspendedAt) - never hand-pick, so a
            // suspended badge can never read as verified in chat.
            ...PUBLIC_BADGE_SELECT,
            photos: {
              orderBy: [{ isCover: "desc" }, { position: "asc" }],
              take: 1,
              select: { url: true },
            },
          },
        },
      },
    }),
    db.profile.findUnique({
      where: { userId },
      select: {
        city: true,
        relationshipGoal: true,
        availabilityTags: true,
        communityTags: true,
        interests: { select: { interest: { select: { slug: true } } } },
      },
    }),
    listThreadMessages(conversationId, { take: 100 }),
  ]);
  const messages = threadPage.messages;
  if (!participant) notFound();

  await markRead(conversationId, userId);

  const otherName = other?.user.profile?.displayName ?? "Member";
  const online = other ? presenceOnline(other.user.lastActiveAt) : false;
  const mySlugs = new Set(myProfile?.interests.map((i) => i.interest.slug) ?? []);
  const otherInterests = other?.user.profile?.interests ?? [];
  const theirPrompts = (other?.user.profile?.prompts ?? []).map((p) => ({
    key: p.promptKey,
    label: promptLabel(p.promptKey),
    answer: p.answer,
  }));
  const suggestedDraft = typeof suggest === "string" ? suggest.slice(0, 500) : "";

  // Taxonomy categories BOTH people belong to - the assistant's cold-open
  // openers come from these categories' chatPromptTemplates.
  const otherProfile = other?.user.profile;
  const sharedCategoryIds =
    myProfile && otherProfile
      ? (() => {
          const mine = new Set(
            categoriesForProfile({
              relationshipGoal: myProfile.relationshipGoal,
              availabilityTags: myProfile.availabilityTags,
              communityTags: myProfile.communityTags,
              interestSlugs: myProfile.interests.map((i) => i.interest.slug),
            }).map((c) => c.id),
          );
          return categoriesForProfile({
            relationshipGoal: otherProfile.relationshipGoal,
            availabilityTags: otherProfile.availabilityTags,
            communityTags: otherProfile.communityTags,
            interestSlugs: otherProfile.interests.map((i) => i.interest.slug),
          })
            .filter((c) => mine.has(c.id))
            .map((c) => c.id);
        })()
      : [];

  const peek = {
    displayName: otherName,
    age: other?.user.profile ? calculateAge(other.user.profile.birthDate) : null,
    city: other?.user.profile?.city ?? null,
    bio: other?.user.profile?.bio ?? null,
    interests: otherInterests.map((i) => i.interest.label),
    sharedInterests: otherInterests
      .filter((i) => mySlugs.has(i.interest.slug))
      .map((i) => i.interest.label),
    isVerified: other ? isPubliclyVerified(other.user) : false,
    isOnline: online,
    photoUrl: other?.user.photos[0]?.url ?? null,
    sameCity:
      myProfile?.city && other?.user.profile?.city === myProfile.city ? myProfile.city : null,
  };

  return (
    <>
      {/* Page heading for AT - the visual header below is a toolbar */}
      <h1 className="sr-only">Conversation with {otherName}</h1>

      {/* Gradient conversation header */}
      <header className="glass relative mb-3 flex items-center gap-3 overflow-hidden rounded-lg p-2.5 pr-3">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(24rem_10rem_at_20%_0%,color-mix(in_srgb,var(--primary)_14%,transparent),transparent_70%)]"
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to chats"
          className="relative rounded-full"
          asChild
        >
          <Link href="/chat">
            <ArrowLeft className="size-5" />
          </Link>
        </Button>

        <ProfilePeek profile={peek}>
          <button
            type="button"
            className="relative flex min-w-0 flex-1 items-center gap-3 rounded-2xl text-left"
            aria-label={`View ${otherName}'s profile`}
          >
            <div className="relative shrink-0">
              <Avatar className="border-border size-11 border">
                <AvatarImage src={peek.photoUrl ?? undefined} alt="" />
                <AvatarFallback>{initialsOf(otherName)}</AvatarFallback>
              </Avatar>
              <OnlineDot online={online} className="absolute -right-0.5 -bottom-0.5" />
            </div>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate font-semibold">
                {otherName}
                {peek.isVerified && (
                  <VerifiedBadge
                    className="shrink-0 text-[16px]"
                    iconClassName="text-card fill-sky-400"
                  />
                )}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                {online ? <span className="text-success">Online now</span> : "Recently active"}
                {peek.sharedInterests[0]
                  ? ` · you both love ${peek.sharedInterests[0].toLowerCase()}`
                  : ""}
              </p>
            </div>
          </button>
        </ProfilePeek>

        {other && (
          <div className="relative">
            <ChatActions otherUserId={other.user.id} otherName={otherName} />
          </div>
        )}
      </header>

      <ChatThread
        conversationId={conversationId}
        currentUserId={userId}
        otherName={otherName}
        sharedCategoryIds={sharedCategoryIds}
        sharedInterests={peek.sharedInterests}
        theirPrompts={theirPrompts}
        theyAreOnline={online}
        initialDraft={suggestedDraft}
        initialMessages={messages as ThreadMessage[]}
      />
    </>
  );
}
