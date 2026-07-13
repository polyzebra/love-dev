import type { Metadata } from "next";
import { Bell, BadgeCheck, Heart, MessageCircle, ShieldCheck, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { formatRelativeTime, cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Notifications" };

const ICONS = {
  NEW_MATCH: Heart,
  NEW_MESSAGE: MessageCircle,
  NEW_LIKE: Heart,
  SUPER_LIKE: Sparkles,
  PROFILE_VERIFIED: BadgeCheck,
  SUBSCRIPTION: Sparkles,
  SAFETY: ShieldCheck,
  SYSTEM: Bell,
} as const;

/** Unified notification centre - likes, matches, messages, verification,
 *  subscription and system events in one push-ready stream. */
export default async function NotificationsPage() {
  const user = await requireUser();
  // One batched transaction instead of two awaits. Order still matters
  // (the list must show pre-read state so unread styling survives this
  // very render), so this is NOT a Promise.all candidate - the batch
  // keeps SELECT-before-UPDATE while collapsing the two roundtrips.
  const [notifications] = await db.$transaction([
    db.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Everything that happened while you were away."
      />
      {notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Nothing yet"
          description="Likes, matches and messages will land here."
        />
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => {
            const Icon = ICONS[n.type] ?? Bell;
            return (
              <li
                key={n.id}
                className={cn(
                  "glass flex items-start gap-3 rounded-3xl p-4",
                  !n.readAt && "border-foreground/20",
                )}
              >
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full",
                    n.readAt ? "bg-foreground/5" : "bg-primary/15",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4.5",
                      n.readAt ? "text-muted-foreground" : "text-primary-soft",
                    )}
                    aria-hidden="true"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{n.title}</p>
                  {n.body && <p className="text-muted-foreground text-sm">{n.body}</p>}
                </div>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {formatRelativeTime(n.createdAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
