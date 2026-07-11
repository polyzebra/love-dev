import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUpRight,
  Ban,
  Gavel,
  Scale,
  ShieldAlert,
  ShieldOff,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { requireAdminPage } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { formatRelativeTime } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Trust & safety" };
export const dynamic = "force-dynamic";

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

const SEVERITY_BADGE: Record<(typeof SEVERITIES)[number], "destructive" | "default" | "secondary" | "outline"> = {
  CRITICAL: "destructive",
  HIGH: "default",
  MEDIUM: "secondary",
  LOW: "outline",
};

const ACTION_BADGE: Record<string, "destructive" | "secondary" | "outline"> = {
  BANNED: "destructive",
  SUSPENDED: "destructive",
  LIMITED: "secondary",
  UPLOAD_BLOCKED: "secondary",
  PHOTO_REMOVED: "outline",
  WARNING: "outline",
};

export default async function TrustSafetyOverviewPage() {
  if (!(await requireAdminPage())) return null; // layout renders AccessDenied; keep segment payload empty

  const [
    severityCounts,
    openCases,
    underReview,
    appealedCases,
    pendingAppeals,
    suspended,
    banned,
    limited,
    photoReview,
    recentViolations,
    recentDecisions,
  ] = await Promise.all([
    Promise.all(
      SEVERITIES.map((severity) =>
        db.moderationCase.count({
          where: { severity, status: { in: ["OPEN", "UNDER_REVIEW"] } },
        }),
      ),
    ),
    db.moderationCase.count({ where: { status: "OPEN" } }),
    db.moderationCase.count({ where: { status: "UNDER_REVIEW" } }),
    db.moderationCase.count({ where: { status: "APPEALED" } }),
    db.appeal.count({ where: { status: { in: ["SUBMITTED", "PENDING_REVIEW"] } } }),
    db.user.count({ where: { status: "SUSPENDED" } }),
    db.user.count({ where: { status: "BANNED" } }),
    db.user.count({ where: { status: "LIMITED" } }),
    db.user.count({ where: { status: "PHOTO_REVIEW_REQUIRED" } }),
    db.accountViolation.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        actionTaken: true,
        violationType: true,
        createdAt: true,
        reversedAt: true,
        userId: true,
        user: { select: { email: true } },
      },
    }),
    db.adminLog.findMany({
      where: {
        OR: [{ action: { startsWith: "safety." } }, { action: { startsWith: "appeal." } }],
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, action: true, targetType: true, targetId: true, createdAt: true },
    }),
  ]);

  const queues: { href: string; label: string; value: number; urgent: boolean; icon: LucideIcon }[] = [
    {
      href: "/admin/moderation-cases?status=OPEN",
      label: "Open cases",
      value: openCases,
      urgent: severityCounts[0] > 0,
      icon: Gavel,
    },
    {
      href: "/admin/moderation-cases?status=UNDER_REVIEW",
      label: "Under review",
      value: underReview,
      urgent: false,
      icon: ShieldAlert,
    },
    {
      href: "/admin/appeals",
      label: "Pending appeals",
      value: pendingAppeals,
      urgent: pendingAppeals > 0,
      icon: Scale,
    },
  ];

  const restrictions: { label: string; value: number; icon: LucideIcon; sub: string }[] = [
    { label: "Suspended", value: suspended, icon: UserX, sub: "awaiting human review" },
    { label: "Banned", value: banned, icon: Ban, sub: "closed accounts" },
    { label: "Limited", value: limited, icon: ShieldAlert, sub: "engagement paused" },
    { label: "Photo review", value: photoReview, icon: ShieldOff, sub: "verification required" },
  ];

  return (
    <>
      <PageHeader
        title="Trust & safety"
        description="Moderation cases, appeals and enforcement at a glance."
      />

      <section aria-label="Work queues" className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Queues
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {queues.map(({ href, label, value, urgent, icon: Icon }) => (
            <Link key={href} href={href}>
              <Card className="rounded-3xl transition-shadow hover:shadow-float">
                <CardContent className="flex items-center gap-4 py-5">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent">
                    <Icon className="size-5 text-accent-foreground" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-muted-foreground">{label}</p>
                    <p className="text-2xl font-semibold tabular-nums">{value}</p>
                  </div>
                  {urgent && (
                    <Badge variant="destructive" className="rounded-full">
                      Needs attention
                    </Badge>
                  )}
                  <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section aria-label="Open cases by severity" className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Open cases by severity
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SEVERITIES.map((severity, i) => (
            <Link key={severity} href={`/admin/moderation-cases?severity=${severity}`}>
              <Card className="h-full rounded-3xl transition-shadow hover:shadow-float">
                <CardContent className="py-5">
                  <div className="flex items-center justify-between">
                    <Badge variant={SEVERITY_BADGE[severity]} className="rounded-full">
                      {severity.toLowerCase()}
                    </Badge>
                  </div>
                  <p className="mt-3 font-display text-3xl font-semibold tabular-nums">
                    {severityCounts[i]}
                  </p>
                  <p className="text-xs text-muted-foreground">open or under review</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
        {appealedCases > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            Plus {appealedCases} case{appealedCases === 1 ? "" : "s"} currently under appeal.
          </p>
        )}
      </section>

      <section aria-label="Account restrictions" className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Accounts under restriction
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {restrictions.map(({ label, value, icon: Icon, sub }) => (
            <Card key={label} className="h-full rounded-3xl">
              <CardContent className="py-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">{label}</p>
                  <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                </div>
                <p className="mt-2 font-display text-3xl font-semibold tabular-nums">{value}</p>
                <p className="text-xs text-muted-foreground">{sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Recent enforcement" className="rounded-3xl border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">Recent enforcement actions</h2>
          {recentViolations.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No enforcement actions yet.
            </p>
          ) : (
            <ul className="divide-y">
              {recentViolations.map((v) => (
                <li key={v.id} className="flex items-center gap-3 py-2.5">
                  <Badge variant={ACTION_BADGE[v.actionTaken] ?? "outline"} className="rounded-full">
                    {v.actionTaken.toLowerCase().replace(/_/g, " ")}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/admin/users/${v.userId}`}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {v.user.email}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {v.violationType.toLowerCase().replace(/_/g, " ")} ·{" "}
                      {formatRelativeTime(v.createdAt)} ago
                      {v.reversedAt ? " · reversed" : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Recent staff decisions" className="rounded-3xl border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">Recent staff decisions</h2>
          {recentDecisions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No safety decisions logged yet.
            </p>
          ) : (
            <ul className="divide-y">
              {recentDecisions.map((entry) => (
                <li key={entry.id} className="py-2.5">
                  <p className="text-sm font-medium">{entry.action}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.targetType ?? "target"} {entry.targetId ? `· ${entry.targetId}` : ""} ·{" "}
                    {formatRelativeTime(entry.createdAt)} ago
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
