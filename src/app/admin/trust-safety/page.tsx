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
import { countModerationCases, listProviderHealth } from "@/lib/services/appeals";
import { externalProvider, pickProvider } from "@/lib/services/moderation";
import { resolveConfiguredProviders } from "@/lib/services/moderation-providers";
import { isEmailConfigured, pickEmailProvider } from "@/lib/services/email";
import { formatAgo } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  ENFORCEMENT_BADGE,
  SEVERITY_BADGE,
  humanizeAdminAction,
  pretty,
  shortId,
} from "../safety-badges";

export const metadata: Metadata = { title: "Trust & safety" };
export const dynamic = "force-dynamic";

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

/** Risk-score bands - aligned with trust-engine.recommendedActionFor. */
const RISK_BANDS = [
  { label: "0-14", min: 0, max: 14, hint: "no action" },
  { label: "15-29", min: 15, max: 29, hint: "warning" },
  { label: "30-44", min: 30, max: 44, hint: "verify / warn" },
  { label: "45-54", min: 45, max: 54, hint: "limit / hide" },
  { label: "55-69", min: 55, max: 69, hint: "manual review" },
  { label: "70-84", min: 70, max: 84, hint: "suspend" },
  { label: "85-100", min: 85, max: 100, hint: "ban (human)" },
] as const;

/** "3.5h" / "2d 4h" for operational averages. */
function formatHours(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours % 24);
  return rest > 0 ? `${days}d ${rest}h` : `${days}d`;
}

function averageHours(pairs: { from: Date; to: Date | null }[]): number | null {
  const spans = pairs
    .filter((p): p is { from: Date; to: Date } => p.to !== null)
    .map((p) => p.to.getTime() - p.from.getTime());
  if (spans.length === 0) return null;
  return spans.reduce((a, b) => a + b, 0) / spans.length / 3_600_000;
}

function pct(part: number, total: number): string {
  if (total === 0) return "-";
  return `${Math.round((part / total) * 100)}%`;
}

function Stat({
  label,
  value,
  sub,
  urgent,
}: {
  label: string;
  value: string;
  sub: string;
  urgent?: boolean;
}) {
  return (
    <Card className="h-full rounded-3xl">
      <CardContent className="py-5">
        <p className="text-muted-foreground text-sm font-medium">{label}</p>
        <p
          className={`font-display mt-2 text-3xl font-semibold tabular-nums ${
            urgent ? "text-destructive" : ""
          }`}
        >
          {value}
        </p>
        <p className="text-muted-foreground text-xs">{sub}</p>
      </CardContent>
    </Card>
  );
}

export default async function TrustSafetyOverviewPage() {
  if (!(await requireAdminPage())) return null; // layout renders AccessDenied; keep segment payload empty

  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const d30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

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
    // --- operational metrics (all real data, honest zeros) ---------------
    casesToday,
    appealsToday,
    overdueCount,
    responded30,
    resolved30,
    photoResults30,
    repeatOffenderGroups,
    verificationsStarted,
    verificationsApproved,
    riskBandCounts,
    workloadGroups,
    violationsTotal,
    violationsReversed,
    providerHealth,
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
    db.appeal.count({
      where: { status: { in: ["SUBMITTED", "PENDING_REVIEW", "UNDER_REVIEW", "NEEDS_INFO"] } },
    }),
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
    db.moderationCase.count({ where: { createdAt: { gte: dayStart } } }),
    db.appeal.count({ where: { createdAt: { gte: dayStart } } }),
    countModerationCases({ overdueOnly: true }),
    db.moderationCase.findMany({
      where: { createdAt: { gte: d30 }, firstResponseAt: { not: null } },
      select: { createdAt: true, firstResponseAt: true },
      take: 2000,
    }),
    db.moderationCase.findMany({
      where: { createdAt: { gte: d30 }, resolvedAt: { not: null } },
      select: { createdAt: true, resolvedAt: true },
      take: 2000,
    }),
    Promise.all(
      (["APPROVED", "REJECTED", "NEEDS_REVIEW", "FAILED"] as const).map((resultStatus) =>
        db.photoModerationResult.count({
          where: { resultStatus, createdAt: { gte: d30 } },
        }),
      ),
    ),
    db.accountViolation.groupBy({
      by: ["userId"],
      where: { reversedAt: null },
      _count: { userId: true },
      having: { userId: { _count: { gte: 2 } } },
    }),
    db.verification.count(),
    db.verification.count({ where: { status: "APPROVED" } }),
    Promise.all(
      RISK_BANDS.map((band) =>
        db.user.count({ where: { safetyRiskScore: { gte: band.min, lte: band.max } } }),
      ),
    ),
    db.moderationCase.groupBy({
      by: ["assignedToId"],
      where: {
        status: { in: ["OPEN", "UNDER_REVIEW", "APPEALED"] },
        assignedToId: { not: null },
      },
      _count: { assignedToId: true },
    }),
    db.accountViolation.count(),
    db.accountViolation.count({ where: { reversedAt: { not: null } } }),
    listProviderHealth(),
  ]);

  const avgFirstResponse = averageHours(
    responded30.map((c) => ({ from: c.createdAt, to: c.firstResponseAt })),
  );
  const avgResolution = averageHours(
    resolved30.map((c) => ({ from: c.createdAt, to: c.resolvedAt })),
  );
  const [photoApproved, photoRejected, photoNeedsReview, photoFailed] = photoResults30;
  const photoTotal = photoApproved + photoRejected + photoNeedsReview + photoFailed;
  const maxBand = Math.max(1, ...riskBandCounts);

  // Provider plane - same sources as GET /api/admin/safety/providers.
  const moderationChain = resolveConfiguredProviders(externalProvider).map((p) => p.name);
  const activeModeration = pickProvider().name;
  const emailConfigured = isEmailConfigured();
  const emailProvider = pickEmailProvider().name;
  const healthByProvider = new Map(providerHealth.map((h) => [h.provider, h]));

  // Assignee emails for the workload list (bounded by staff size).
  const workloadIds = workloadGroups.map((g) => g.assignedToId).filter((id): id is string => !!id);
  const workloadUsers =
    workloadIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: workloadIds } },
          select: { id: true, email: true },
        })
      : [];
  const workloadEmail = new Map(workloadUsers.map((u) => [u.id, u.email]));
  const workload = workloadGroups
    .map((g) => ({
      id: g.assignedToId as string,
      email: workloadEmail.get(g.assignedToId as string) ?? g.assignedToId,
      count: g._count.assignedToId,
    }))
    .sort((a, b) => b.count - a.count);

  const queues: {
    href: string;
    label: string;
    value: number;
    urgent: boolean;
    icon: LucideIcon;
  }[] = [
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
      label: "Open appeals",
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
        <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
          Queues
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {queues.map(({ href, label, value, urgent, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="focus-visible:ring-foreground/20 block rounded-3xl focus-visible:ring-2 focus-visible:outline-none"
            >
              <Card className="hover:shadow-float rounded-3xl transition-shadow">
                <CardContent className="flex flex-wrap items-center gap-4 py-5">
                  <span className="bg-accent flex size-11 shrink-0 items-center justify-center rounded-2xl">
                    <Icon className="text-accent-foreground size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-muted-foreground text-sm font-medium">{label}</p>
                    <p className="text-2xl font-semibold tabular-nums">{value}</p>
                  </div>
                  {urgent && (
                    <Badge variant="destructive" className="rounded-full">
                      Needs attention
                    </Badge>
                  )}
                  <ArrowUpRight
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden="true"
                  />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section aria-label="Operations" className="mb-8">
        <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
          Operations
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Cases today" value={String(casesToday)} sub="opened since midnight" />
          <Stat label="Appeals today" value={String(appealsToday)} sub="submitted since midnight" />
          <Stat
            label="Overdue cases"
            value={String(overdueCount)}
            sub="past their SLA right now"
            urgent={overdueCount > 0}
          />
          <Stat
            label="Avg first response"
            value={avgFirstResponse == null ? "-" : formatHours(avgFirstResponse)}
            sub={
              avgFirstResponse == null
                ? "no responded cases in 30 days"
                : `${responded30.length} cases · last 30 days`
            }
          />
          <Stat
            label="Avg resolution"
            value={avgResolution == null ? "-" : formatHours(avgResolution)}
            sub={
              avgResolution == null
                ? "no resolved cases in 30 days"
                : `${resolved30.length} cases · last 30 days`
            }
          />
        </div>
      </section>

      <section aria-label="Quality, last 30 days" className="mb-8">
        <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
          Quality · last 30 days
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Photo approvals"
            value={pct(photoApproved, photoTotal)}
            sub={
              photoTotal === 0
                ? "no automated photo checks yet"
                : `${photoApproved} approved / ${photoRejected} rejected / ${photoNeedsReview + photoFailed} to humans`
            }
          />
          <Stat
            label="False positives"
            value={pct(violationsReversed, violationsTotal)}
            sub={
              violationsTotal === 0
                ? "no enforcement actions yet"
                : `${violationsReversed} of ${violationsTotal} actions reversed (all time)`
            }
          />
          <Stat
            label="Verification conversion"
            value={pct(verificationsApproved, verificationsStarted)}
            sub={
              verificationsStarted === 0
                ? "no verifications started yet"
                : `${verificationsApproved} approved of ${verificationsStarted} started (all time)`
            }
          />
          <Stat
            label="Repeat offenders"
            value={String(repeatOffenderGroups.length)}
            sub="accounts with 2+ active violations"
            urgent={repeatOffenderGroups.length > 0}
          />
        </div>
      </section>

      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <section aria-label="Trust score distribution" className="bg-card rounded-3xl border p-5">
          <h2 className="mb-1 text-sm font-semibold">Trust-score distribution</h2>
          <p className="text-muted-foreground mb-3 text-xs">
            All accounts by safety risk score (0 = no signals). Bands mirror the risk engine.
          </p>
          <ul className="space-y-2">
            {RISK_BANDS.map((band, i) => (
              <li key={band.label} className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground w-14 shrink-0 text-xs tabular-nums">
                  {band.label}
                </span>
                <span className="bg-muted h-2.5 flex-1 overflow-hidden rounded-full">
                  <span
                    className={`block h-full rounded-full ${
                      band.min >= 70 ? "bg-destructive/70" : "bg-foreground/30"
                    }`}
                    style={{ width: `${Math.round((riskBandCounts[i] / maxBand) * 100)}%` }}
                  />
                </span>
                <span className="w-12 shrink-0 text-right text-xs tabular-nums">
                  {riskBandCounts[i]}
                </span>
                <span className="text-muted-foreground hidden w-28 shrink-0 text-xs sm:block">
                  {band.hint}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Moderator workload" className="bg-card rounded-3xl border p-5">
          <h2 className="mb-1 text-sm font-semibold">Moderator workload</h2>
          <p className="text-muted-foreground mb-3 text-xs">
            Open cases per assignee. Unassigned cases:{" "}
            <Link
              href="/admin/moderation-cases?assigned=unassigned"
              className="underline underline-offset-2"
            >
              view queue
            </Link>
            .
          </p>
          {workload.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              No cases are assigned right now.
            </p>
          ) : (
            <ul className="divide-y">
              {workload.map((w) => (
                <li key={w.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{w.email}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {w.count} open case{w.count === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-label="Provider health" className="bg-card mb-8 rounded-3xl border p-5">
        <h2 className="mb-1 text-sm font-semibold">Provider health</h2>
        <p className="text-muted-foreground mb-3 text-xs">
          External moderation chain and email transport - names and health only, never keys.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Photo moderation
            </p>
            {moderationChain.length === 0 ? (
              <p className="mt-2 text-sm">
                <Badge variant="outline" className="rounded-full">
                  Not configured
                </Badge>{" "}
                <span className="text-muted-foreground">
                  No external provider keys set - uploads queue for human review
                  {activeModeration === "mock" ? " (mock provider active in this environment)" : ""}
                  .
                </span>
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {moderationChain.map((name, i) => {
                  const h = healthByProvider.get(name);
                  const failing = (h?.consecutiveFailures ?? 0) > 0;
                  return (
                    <li key={name} className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge
                        variant={name === activeModeration ? "secondary" : "outline"}
                        className="rounded-full"
                      >
                        {i + 1}. {name}
                      </Badge>
                      {name === activeModeration && (
                        <span className="text-muted-foreground text-xs">active</span>
                      )}
                      {failing ? (
                        <Badge variant="destructive" className="rounded-full">
                          {h!.consecutiveFailures} consecutive failure
                          {h!.consecutiveFailures === 1 ? "" : "s"}
                        </Badge>
                      ) : h?.lastSuccessAt ? (
                        <span className="text-muted-foreground text-xs">
                          ok · last success {formatAgo(h.lastSuccessAt)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">no calls recorded yet</span>
                      )}
                      {failing && h?.lastError && (
                        <span className="text-muted-foreground w-full truncate text-xs">
                          last error: {h.lastError}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div>
            <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Email transport
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              {emailConfigured ? (
                <>
                  <Badge variant="secondary" className="rounded-full">
                    {emailProvider}
                  </Badge>
                  <span className="text-muted-foreground">configured - outbox delivers</span>
                </>
              ) : (
                <>
                  <Badge variant="outline" className="rounded-full">
                    Not configured
                  </Badge>
                  <span className="text-muted-foreground">
                    RESEND_API_KEY not set - safety emails park in the outbox as undeliverable.
                  </span>
                </>
              )}
            </p>
            {(() => {
              const h = healthByProvider.get(emailProvider);
              if (!h) return null;
              return h.consecutiveFailures > 0 ? (
                <p className="mt-2 text-sm">
                  <Badge variant="destructive" className="rounded-full">
                    {h.consecutiveFailures} consecutive failure
                    {h.consecutiveFailures === 1 ? "" : "s"}
                  </Badge>{" "}
                  <span className="text-muted-foreground text-xs">{h.lastError}</span>
                </p>
              ) : h.lastSuccessAt ? (
                <p className="text-muted-foreground mt-2 text-xs">
                  ok · last successful send {formatAgo(h.lastSuccessAt)}
                </p>
              ) : null;
            })()}
          </div>
        </div>
      </section>

      <section aria-label="Open cases by severity" className="mb-8">
        <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
          Open cases by severity
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SEVERITIES.map((severity, i) => (
            <Link
              key={severity}
              href={`/admin/moderation-cases?severity=${severity}`}
              className="focus-visible:ring-foreground/20 block h-full rounded-3xl focus-visible:ring-2 focus-visible:outline-none"
            >
              <Card className="hover:shadow-float h-full rounded-3xl transition-shadow">
                <CardContent className="py-5">
                  <div className="flex items-center justify-between">
                    <Badge variant={SEVERITY_BADGE[severity]} className="rounded-full">
                      {severity.toLowerCase()}
                    </Badge>
                  </div>
                  <p className="font-display mt-3 text-3xl font-semibold tabular-nums">
                    {severityCounts[i]}
                  </p>
                  <p className="text-muted-foreground text-xs">open or under review</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
        {appealedCases > 0 && (
          <p className="text-muted-foreground mt-3 text-sm">
            Plus {appealedCases} case{appealedCases === 1 ? "" : "s"} currently under appeal.
          </p>
        )}
      </section>

      <section aria-label="Account restrictions" className="mb-8">
        <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
          Accounts under restriction
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {restrictions.map(({ label, value, icon: Icon, sub }) => (
            <Card key={label} className="h-full rounded-3xl">
              <CardContent className="py-5">
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground text-sm font-medium">{label}</p>
                  <Icon className="text-muted-foreground size-4" aria-hidden="true" />
                </div>
                <p className="font-display mt-2 text-3xl font-semibold tabular-nums">{value}</p>
                <p className="text-muted-foreground text-xs">{sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Recent enforcement" className="bg-card rounded-3xl border p-5">
          <h2 className="mb-3 text-sm font-semibold">Recent enforcement actions</h2>
          {recentViolations.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              No enforcement actions yet.
            </p>
          ) : (
            <ul className="divide-y">
              {recentViolations.map((v) => (
                <li key={v.id} className="flex items-center gap-3 py-2.5">
                  <Badge
                    variant={ENFORCEMENT_BADGE[v.actionTaken] ?? "outline"}
                    className="rounded-full"
                  >
                    {pretty(v.actionTaken)}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/admin/users/${v.userId}`}
                      title={v.user.email}
                      className="focus-visible:ring-foreground/20 block truncate text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
                    >
                      {v.user.email}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      {pretty(v.violationType)} · {formatAgo(v.createdAt)}
                      {v.reversedAt ? " · reversed" : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Recent staff decisions" className="bg-card rounded-3xl border p-5">
          <h2 className="mb-3 text-sm font-semibold">Recent staff decisions</h2>
          {recentDecisions.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              No safety decisions logged yet.
            </p>
          ) : (
            <ul className="divide-y">
              {recentDecisions.map((entry) => (
                <li key={entry.id} className="py-2.5">
                  <p className="text-sm font-medium" title={entry.action}>
                    {humanizeAdminAction(entry.action)}
                  </p>
                  <p className="text-muted-foreground text-xs" title={entry.targetId ?? undefined}>
                    {entry.targetType ?? "target"}{" "}
                    {entry.targetId ? `· ${shortId(entry.targetId)} ` : ""}·{" "}
                    {formatAgo(entry.createdAt)}
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
