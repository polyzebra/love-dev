import type { Metadata } from "next";
import Link from "next/link";
import { ImageIcon } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { cn, formatRelativeTime } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PhotoActions } from "./photo-actions";
import { requireAdminPage } from "@/lib/auth/require-user";

export const metadata: Metadata = { title: "Photo moderation" };
export const dynamic = "force-dynamic";

/**
 * Queue tabs. "Auto-approved" means moderation APPROVED with no human
 * reviewer (moderatedById null) - i.e. decisions made by the automated
 * provider (including the honest "unmoderated" null-provider approvals),
 * newest first so staff can spot-check recent uploads.
 */
const TABS = [
  {
    key: "pending",
    label: "Pending review",
    where: { moderation: "PENDING", status: { not: "DELETED" } },
    orderBy: { createdAt: "asc" },
  },
  {
    key: "rejected",
    label: "Rejected",
    where: { moderation: "REJECTED" },
    orderBy: { createdAt: "desc" },
  },
  {
    key: "approved",
    label: "Auto-approved",
    where: { moderation: "APPROVED", moderatedById: null },
    orderBy: { createdAt: "desc" },
  },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  where: Prisma.PhotoWhereInput;
  orderBy: Prisma.PhotoOrderByWithRelationInput;
}>;

type TabKey = (typeof TABS)[number]["key"];

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "-";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function AdminPhotosPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  if (!(await requireAdminPage())) return null; // layout renders AccessDenied; keep segment payload empty
  const { tab: rawTab } = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === rawTab) ? (rawTab as TabKey) : "pending";
  const active = TABS.find((t) => t.key === tab)!;

  const [counts, photos] = await Promise.all([
    Promise.all(TABS.map((t) => db.photo.count({ where: t.where }))),
    db.photo.findMany({
      where: active.where,
      include: {
        user: {
          select: { id: true, email: true, name: true, profile: { select: { displayName: true } } },
        },
        moderationEvents: { orderBy: { createdAt: "desc" } },
      },
      orderBy: active.orderBy,
      take: 50,
    }),
  ]);

  // PhotoModerationEvent stores only actorId - resolve staff emails for the
  // history display (null actorId = automated decision).
  const actorIds = [
    ...new Set(
      photos.flatMap((p) => p.moderationEvents.map((e) => e.actorId)).filter((id) => id != null),
    ),
  ];
  const actors =
    actorIds.length > 0
      ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } })
      : [];
  const actorEmail = new Map(actors.map((a) => [a.id, a.email]));

  return (
    <>
      <PageHeader
        title="Photo moderation"
        description="Automated verdicts land here; rejected photos are never publicly served."
      />

      <nav aria-label="Moderation queues" className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t, i) => (
          <Link
            key={t.key}
            href={`/admin/photos?tab=${t.key}`}
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              t.key === tab
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t.label}
            <span className="text-xs tabular-nums opacity-70">{counts[i]}</span>
          </Link>
        ))}
      </nav>

      {photos.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title="Queue clear"
          description={`No photos in "${active.label}".`}
        />
      ) : (
        <div className="overflow-x-auto rounded-3xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Photo</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>File</TableHead>
                <TableHead>AI score</TableHead>
                <TableHead>Face</TableHead>
                <TableHead>History</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {photos.map((photo) => (
                <TableRow key={photo.id}>
                  <TableCell>
                    {/* Plain img on purpose: /api/media enforces auth (staff
                        bypass) and next/image must not cache private bytes. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.thumbUrl ?? photo.url}
                      alt={`Photo by ${photo.user.profile?.displayName ?? photo.user.email}`}
                      className="h-20 w-16 rounded-xl bg-muted object-cover"
                      loading="lazy"
                    />
                    {photo.isCover && (
                      <Badge variant="outline" className="mt-1 rounded-full text-[10px]">
                        Cover
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/users?q=${encodeURIComponent(photo.user.email)}`}
                      className="font-medium hover:underline"
                    >
                      {photo.user.profile?.displayName ?? photo.user.name ?? "-"}
                    </Link>
                    <p className="text-xs text-muted-foreground">{photo.user.email}</p>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatRelativeTime(photo.createdAt)} ago
                  </TableCell>
                  <TableCell>
                    <p className="text-sm">{photo.mimeType ?? "-"}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(photo.sizeBytes)}</p>
                    <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span
                        className="inline-block size-3.5 rounded-full border"
                        style={
                          photo.dominantColor ? { backgroundColor: photo.dominantColor } : undefined
                        }
                        aria-hidden="true"
                      />
                      {photo.dominantColor ?? "-"}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {/* null = no provider scored it. Never show a made-up number. */}
                    {photo.aiScore != null ? photo.aiScore.toFixed(2) : "-"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {photo.faceDetected == null ? "-" : photo.faceDetected ? "Yes" : "No"}
                    <p className="text-xs text-muted-foreground">
                      {photo.facesCount != null ? `${photo.facesCount} face(s)` : "-"}
                    </p>
                  </TableCell>
                  <TableCell className="max-w-64">
                    {photo.moderationEvents.length === 0 ? (
                      <span className="text-sm text-muted-foreground">-</span>
                    ) : (
                      <details>
                        <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                          {photo.moderationEvents.length} event
                          {photo.moderationEvents.length === 1 ? "" : "s"}
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {photo.moderationEvents.map((event) => (
                            <li key={event.id} className="text-xs">
                              <p className="font-medium">
                                {event.action}
                                <span className="ml-1.5 font-normal text-muted-foreground">
                                  {formatRelativeTime(event.createdAt)} ago ·{" "}
                                  {event.actorId
                                    ? (actorEmail.get(event.actorId) ?? event.actorId)
                                    : "automated"}
                                  {event.aiScore != null ? ` · score ${event.aiScore.toFixed(2)}` : ""}
                                </span>
                              </p>
                              {event.reason && (
                                <p className="text-muted-foreground">{event.reason}</p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <PhotoActions photoId={photo.id} moderation={photo.moderation} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
