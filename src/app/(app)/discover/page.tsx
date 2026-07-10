import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { getDiscoverFeed } from "@/lib/services/discovery";
import { SwipeDeck, type ViewerContext } from "@/components/app/swipe-deck";

export const metadata: Metadata = { title: "Discover" };

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
        id: user.id,
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
      {/* Deliberately NO Suspense boundary: the page is not 'ready' until
          the deck data resolves, so soft navigation keeps the PREVIOUS page
          visible (with the top progress bar) instead of landing on a
          full-screen loader or a blank stage. */}
      <Deck backHref={backHref} />
    </>
  );
}
