import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { getDiscoverFeed } from "@/lib/services/discovery";
import { SwipeDeck, type ViewerContext } from "@/components/app/swipe-deck";
import { PageLoader } from "@/components/shared/page-loader";

export const metadata: Metadata = { title: "Discover" };
export const dynamic = "force-dynamic";

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
      {/* Full-stage fallback: same fixed stage geometry as SwipeDeck, no placeholder shapes */}
      <Suspense fallback={<PageLoader fullStage />}>
        <Deck backHref={backHref} />
      </Suspense>
    </>
  );
}
