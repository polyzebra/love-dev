import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { getDiscoverFeed } from "@/lib/services/discovery";
import { SwipeDeck, type ViewerContext } from "@/components/app/swipe-deck";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Discover" };
export const dynamic = "force-dynamic";

/* Mirrors the SwipeDeck stage geometry so the skeleton is full-stage too */
function DeckSkeleton() {
  return (
    <div className="fixed inset-0 z-30 overflow-hidden bg-background">
      <div className="absolute inset-0 flex justify-center md:py-3 lg:left-72 lg:py-4">
        <div className="relative h-full w-full md:w-[min(100%,calc((100dvh-1.5rem)*0.78))] lg:w-[min(100%,calc((100dvh-2rem)*0.78))]">
          <Skeleton className="h-full w-full rounded-none md:rounded-[20px] lg:rounded-[24px]" />
          <div className="absolute inset-x-0 bottom-[calc(max(1rem,var(--safe-bottom))+4.75rem)] flex items-center justify-center gap-5 sm:gap-6 lg:bottom-[calc(var(--safe-bottom)+2rem)]">
            <Skeleton className="size-12 rounded-full" />
            <Skeleton className="size-14 rounded-full" />
            <Skeleton className="size-[4.5rem] rounded-full" />
            <Skeleton className="size-12 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

async function Deck({ backHref }: { backHref: string | null }) {
  const user = await requireUser();
  if (!user.id) return <SwipeDeck initialProfiles={[]} viewer={null} backHref={backHref} />;

  const [feed, me] = await Promise.all([
    getDiscoverFeed(user.id),
    db.profile.findUnique({
      where: { userId: user.id },
      select: {
        city: true,
        relationshipGoal: true,
        interests: { select: { interest: { select: { label: true } } } },
      },
    }),
  ]);

  const viewer: ViewerContext | null = me
    ? {
        city: me.city,
        interests: me.interests.map((i) => i.interest.label),
        goal: me.relationshipGoal,
      }
    : null;

  return <SwipeDeck initialProfiles={feed} viewer={viewer} backHref={backHref} />;
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const backHref = from?.startsWith("/explore") ? from : null;
  return (
    <>
      {/* The stage is the page - no header; its controls float over the photo */}
      <h1 className="sr-only">Swipe</h1>
      <Suspense fallback={<DeckSkeleton />}>
        <Deck backHref={backHref} />
      </Suspense>
    </>
  );
}
