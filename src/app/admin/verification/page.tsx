import type { Metadata } from "next";
import { BadgeCheck } from "lucide-react";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { VerificationActions } from "./verification-actions";
import { formatAgo } from "@/lib/utils";
import { requireAdminPage } from "@/lib/auth/require-user";

export const metadata: Metadata = { title: "Verification queue" };

/** "Verified today" / "Verified yesterday" / "Verified N days ago". */
function verifiedAgoLabel(date: Date, now: Date = new Date()): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.max(0, Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000));
  if (days === 0) return "Verified today";
  if (days === 1) return "Verified yesterday";
  return `Verified ${days} days ago`;
}
export const dynamic = "force-dynamic";

export default async function AdminVerificationPage() {
  if (!(await requireAdminPage())) return null; // layout renders AccessDenied; keep segment payload empty
  // Recent approvals - statusChangedAt is the audit timestamp (stamped by
  // webhook, reconciliation and admin review alike).
  const recentlyVerified = await db.verification.findMany({
    where: { status: "APPROVED", type: { in: ["PHOTO", "IDENTITY"] } },
    orderBy: { statusChangedAt: "desc" },
    take: 8,
    select: {
      id: true,
      type: true,
      statusChangedAt: true,
      updatedAt: true,
      user: { select: { profile: { select: { displayName: true } }, email: true } },
    },
  });
  const queue = await db.verification.findMany({
    where: { status: { in: ["PENDING", "IN_REVIEW"] }, type: { in: ["PHOTO", "IDENTITY"] } },
    include: {
      user: {
        select: {
          email: true,
          profile: { select: { displayName: true, city: true } },
          photos: { orderBy: { position: "asc" }, take: 3, select: { url: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  const recentSection = recentlyVerified.length > 0 && (
    <section className="mb-6">
      <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-[0.2em] uppercase">
        Recently verified
      </p>
      <div className="flex flex-wrap gap-2">
        {recentlyVerified.map((v) => {
          const at = v.statusChangedAt ?? v.updatedAt;
          return (
            <span
              key={v.id}
              title={at.toISOString()}
              className="glass-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs"
            >
              <span className="font-medium">{v.user.profile?.displayName ?? v.user.email}</span>
              <span className="text-muted-foreground">
                · {v.type === "PHOTO" ? "Photo" : "ID"} · {verifiedAgoLabel(at)}
              </span>
            </span>
          );
        })}
      </div>
    </section>
  );

  if (queue.length === 0) {
    return (
      <>
        <PageHeader title="Verification" description="Photo and ID verification reviews." />
        {recentSection}
        <EmptyState
          icon={BadgeCheck}
          title="Queue clear"
          description="No verifications waiting for review."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Verification"
        description={`${queue.length} awaiting review · oldest first`}
      />
      {recentSection}
      <div className="grid gap-4 md:grid-cols-2">
        {queue.map((item) => (
          <Card key={item.id} className="rounded-3xl">
            <CardContent className="space-y-3 py-5">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="rounded-full">
                  {item.type === "PHOTO" ? "Photo verification" : "ID verification"}
                </Badge>
                <span className="text-muted-foreground text-xs">
                  requested {formatAgo(item.createdAt)}
                </span>
              </div>
              <p className="text-sm">
                <span className="font-medium">{item.user.profile?.displayName ?? "-"}</span>{" "}
                <span className="text-muted-foreground">
                  · {item.user.email}
                  {item.user.profile?.city ? ` · ${item.user.profile.city}` : ""}
                </span>
              </p>
              {item.provider && (
                <p className="text-muted-foreground text-xs">
                  Provider: {item.provider} · Session {item.providerSessionId ?? "-"}
                </p>
              )}
              {item.user.photos.length > 0 && (
                <div className="flex gap-2">
                  {item.user.photos.map((photo, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={photo.url}
                      alt={`Profile photo ${i + 1}`}
                      className="size-20 rounded-xl object-cover"
                    />
                  ))}
                </div>
              )}
              <VerificationActions verificationId={item.id} />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
