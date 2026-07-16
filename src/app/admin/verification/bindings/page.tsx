import type { Metadata } from "next";
import Link from "next/link";
import { ShieldQuestion } from "lucide-react";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatAgo } from "@/lib/utils";
import { requireAdminPage } from "@/lib/auth/require-user";
import { hasPermission } from "@/lib/rbac";

export const metadata: Metadata = { title: "Identity binding review" };
export const dynamic = "force-dynamic";

// Kept SEPARATE from the profile-photo review queue: this is identity<->face
// binding, a distinct fact. Tabs by status; oldest first.
const TABS = [
  { key: "MANUAL_REVIEW", label: "Pending review" },
  { key: "BINDING_FAILED", label: "Binding failed" },
  { key: "BOUND", label: "Confirmed" },
  { key: "PROVIDER_UNAVAILABLE", label: "Provider unavailable" },
] as const;

export default async function AdminBindingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const admin = await requireAdminPage("staff");
  if (!admin || !hasPermission(admin.role, "safety:manage")) return null;

  const sp = await searchParams;
  const status = TABS.find((t) => t.key === sp.status)?.key ?? "MANUAL_REVIEW";

  const bindings = await db.faceIdentityBinding.findMany({
    where: { status },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: {
      id: true,
      userId: true,
      status: true,
      method: true,
      createdAt: true,
      reviewedAt: true,
      user: { select: { email: true, profile: { select: { displayName: true } } } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Identity binding review"
        description="Confirm the liveness subject is the same person who completed identity verification. This is separate from profile-photo review."
      />

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/verification/bindings?status=${t.key}`}
            className={`rounded-full border px-3 py-1 text-sm ${
              t.key === status ? "bg-foreground text-background" : "text-muted-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {bindings.length === 0 ? (
        <EmptyState
          icon={ShieldQuestion}
          title="Nothing here"
          description="No bindings in this state."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {bindings.map((b) => (
            <Card key={b.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {b.user?.profile?.displayName ?? b.user?.email ?? "User"}
                  </span>
                  <Badge variant="outline">{b.status}</Badge>
                </div>
                <div className="text-muted-foreground text-xs">
                  {b.method} · requested {formatAgo(b.createdAt)}
                  {b.reviewedAt ? ` · reviewed ${formatAgo(b.reviewedAt)}` : ""}
                </div>
                <Link
                  href={`/admin/verification/bindings/${b.id}`}
                  className="text-primary inline-block text-sm underline"
                >
                  Open review →
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
