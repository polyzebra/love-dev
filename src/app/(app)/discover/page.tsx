import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { requireDiscoveryViewer } from "@/lib/services/discovery-access";
import { db } from "@/lib/db";
import { getDiscoverFeed } from "@/lib/services/discovery";
import { SwipeDeck, type ViewerContext } from "@/components/app/swipe-deck";

export const metadata: Metadata = { title: "Discover" };

async function Deck({ backHref }: { backHref: string | null }) {
  const user = await requireUser();
  if (!user.id) return <SwipeDeck initialProfiles={[]} viewer={null} backHref={backHref} />;

  // L8.3.4F.1 symmetry: the page enforces the SAME canonical Discovery viewer
  // gate as the four API routes (requireDiscoveryViewer -> canEnterDating).
  // requireUser above owns the ladder redirects; this fails CLOSED on a denied
  // capability (e.g. DEACTIVATED). The machine reason is logged inside the
  // helper and never surfaced here - no SHADOW_BANNED / moderation leak, and a
  // hidden-profile viewer (canEnterDating, not canAppearInDiscovery) still browses.
  const { response } = await requireDiscoveryViewer();
  if (response) redirect("/settings");

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
