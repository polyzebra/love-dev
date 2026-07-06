import type { Metadata } from "next";
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { getDiscoverFeed } from "@/lib/services/discovery";
import { SwipeDeck } from "@/components/app/swipe-deck";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = { title: "Discover" };
export const dynamic = "force-dynamic";

function DeckSkeleton() {
  return (
    <div className="mx-auto w-full max-w-sm">
      <Skeleton className="aspect-3/4 w-full rounded-3xl" />
      <div className="mt-6 flex items-center justify-center gap-4">
        <Skeleton className="size-12 rounded-full" />
        <Skeleton className="size-16 rounded-full" />
        <Skeleton className="size-16 rounded-full" />
        <Skeleton className="size-12 rounded-full" />
      </div>
    </div>
  );
}

async function Deck() {
  const session = await auth();
  const feed = session?.user?.id ? await getDiscoverFeed(session.user.id) : [];
  return <SwipeDeck initialProfiles={feed} />;
}

export default function DiscoverPage() {
  return (
    <>
      <PageHeader
        title="Discover"
        description="Profiles picked for you, refreshed daily."
      />
      <Suspense fallback={<DeckSkeleton />}>
        <Deck />
      </Suspense>
    </>
  );
}
