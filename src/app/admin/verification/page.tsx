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
export const dynamic = "force-dynamic";

export default async function AdminVerificationPage() {
  if (!(await requireAdminPage())) return null; // layout renders AccessDenied; keep segment payload empty
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

  if (queue.length === 0) {
    return (
      <>
        <PageHeader title="Verification" description="Photo and ID verification reviews." />
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
      <PageHeader title="Verification" description={`${queue.length} awaiting review · oldest first`} />
      <div className="grid gap-4 md:grid-cols-2">
        {queue.map((item) => (
          <Card key={item.id} className="rounded-3xl">
            <CardContent className="space-y-3 py-5">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="rounded-full">
                  {item.type === "PHOTO" ? "Photo verification" : "ID verification"}
                </Badge>
                <span className="text-xs text-muted-foreground">
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
                <p className="text-xs text-muted-foreground">
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
