import type { Metadata } from "next";
import Link from "next/link";
import { HeartOff } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { calculateAge, initialsOf } from "@/lib/utils";
import { isOnline } from "@/lib/presence";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { OnlineDot } from "@/components/shared/online-dot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Matches" };
export const dynamic = "force-dynamic";

export default async function MatchesPage() {
  const session = await auth();
  const userId = session!.user.id;

  const matches = await db.match.findMany({
    where: { status: "ACTIVE", OR: [{ userAId: userId }, { userBId: userId }] },
    include: {
      conversation: { select: { id: true, lastMessageAt: true } },
      userA: {
        select: {
          id: true,
          lastActiveAt: true,
          profile: { select: { displayName: true, birthDate: true, city: true } },
          photos: { orderBy: [{ isCover: "desc" }, { position: "asc" }], take: 1, select: { url: true } },
        },
      },
      userB: {
        select: {
          id: true,
          lastActiveAt: true,
          profile: { select: { displayName: true, birthDate: true, city: true } },
          photos: { orderBy: [{ isCover: "desc" }, { position: "asc" }], take: 1, select: { url: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (matches.length === 0) {
    return (
      <>
        <PageHeader title="Matches" description="People who liked you back." />
        <EmptyState
          icon={HeartOff}
          title="No matches yet"
          description="Your future match is probably in Discover right now. Keep an open mind - and a complete profile gets up to 3× more likes."
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
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
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
                <div className="relative aspect-4/5 bg-muted">
                  {other.photos[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={other.photos[0].url}
                      alt={`${name}'s photo`}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Avatar className="size-16">
                        <AvatarImage src={undefined} alt="" />
                        <AvatarFallback className="text-xl">{initialsOf(name)}</AvatarFallback>
                      </Avatar>
                    </div>
                  )}
                  {isNew && (
                    <span className="absolute left-3 top-3 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
                      New match
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 p-3">
                  <p className="truncate text-sm font-medium">
                    {name}
                    {age ? `, ${age}` : ""}
                  </p>
                  <OnlineDot online={online} />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
