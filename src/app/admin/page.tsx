import Link from "next/link";
import {
  ArrowUpRight,
  BadgeCheck,
  Ban,
  Flag,
  Gavel,
  HeartHandshake,
  ImageIcon,
  LifeBuoy,
  MessageSquare,
  PauseCircle,
  Scale,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/auth/require-user";
import { PHOTO_VERIFIED_WHERE } from "@/lib/services/verification";
import { daysAgo } from "@/lib/presence";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FaceReadinessCard } from "@/components/admin/face-readiness-card";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  // Pages gate themselves ON TOP of the layout - segment payloads would
  // otherwise stream to forbidden visitors (see requireAdminPage).
  if (!(await requireAdminPage())) return null;
  const dayAgo = daysAgo(1);
  const weekAgo = daysAgo(7);

  const [
    totalUsers,
    activeUsers,
    pendingRegistrations,
    verifiedUsers,
    suspendedUsers,
    bannedUsers,
    newUsersWeek,
    activeToday,
    totalMatches,
    messagesToday,
    openReports,
    pendingPhotos,
    pendingVerifications,
    paidSubscriptions,
    openAppeals,
    openCases,
  ] = await Promise.all([
    db.user.count({ where: { status: { not: "DELETED" } } }),
    db.user.count({ where: { status: "ACTIVE" } }),
    // Registration funnel: accounts still mid-registration (L7.3.8) - born
    // PENDING, invisible/unusable until the ladder completes.
    db.user.count({ where: { status: "PENDING" } }),
    // "Verified" = carries the photo-verified badge (canonical column,
    // see lib/services/verification.ts) or an APPROVED identity review.
    db.user.count({
      where: {
        OR: [
          PHOTO_VERIFIED_WHERE,
          { verifications: { some: { type: "IDENTITY", status: "APPROVED" } } },
        ],
      },
    }),
    db.user.count({ where: { status: "SUSPENDED", bannedAt: null } }),
    db.user.count({ where: { bannedAt: { not: null } } }),
    db.user.count({ where: { createdAt: { gte: weekAgo } } }),
    db.user.count({ where: { lastActiveAt: { gte: dayAgo } } }),
    db.match.count({ where: { status: "ACTIVE" } }),
    db.message.count({ where: { createdAt: { gte: dayAgo } } }),
    db.report.count({ where: { status: "OPEN" } }),
    db.photo.count({ where: { moderation: "PENDING", status: { not: "DELETED" } } }),
    db.verification.count({
      where: { status: { in: ["PENDING", "IN_REVIEW"] }, type: { in: ["PHOTO", "IDENTITY"] } },
    }),
    db.subscription.count({ where: { tier: { not: "FREE" }, status: "ACTIVE" } }),
    db.appeal.count({ where: { status: { in: ["SUBMITTED", "PENDING_REVIEW"] } } }),
    db.moderationCase.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW"] } } }),
  ]);

  const accountStats = [
    {
      label: "Total members",
      value: totalUsers,
      sub: `+${newUsersWeek} this week`,
      icon: Users,
      href: "/admin/users",
    },
    {
      label: "Active",
      value: activeUsers,
      sub: "status ACTIVE",
      icon: UserCheck,
      href: "/admin/users",
    },
    {
      label: "Pending registration",
      value: pendingRegistrations,
      sub: "mid-registration (PENDING)",
      icon: Users,
      href: "/admin/users",
    },
    {
      label: "Verified",
      value: verifiedUsers,
      sub: "approved verification",
      icon: ShieldCheck,
      href: "/admin/verification",
    },
    {
      label: "Suspended",
      value: suspendedUsers,
      sub: "excl. banned",
      icon: PauseCircle,
      href: "/admin/users",
    },
    { label: "Banned", value: bannedUsers, sub: "bannedAt set", icon: Ban, href: "/admin/users" },
  ];

  const activityStats = [
    { label: "Active today", value: activeToday, sub: "last 24 hours", icon: HeartHandshake },
    { label: "Active matches", value: totalMatches, sub: "all time", icon: BadgeCheck },
    { label: "Messages today", value: messagesToday, sub: "last 24 hours", icon: MessageSquare },
    { label: "Paying members", value: paidSubscriptions, sub: "active subscriptions", icon: Users },
  ];

  const queues = [
    {
      href: "/admin/reports",
      label: "Open reports",
      value: openReports,
      urgent: openReports > 0,
      icon: Flag,
    },
    {
      href: "/admin/photos",
      label: "Photo moderation",
      value: pendingPhotos,
      urgent: pendingPhotos > 10,
      icon: ImageIcon,
    },
    {
      href: "/admin/verification",
      label: "Verification queue",
      value: pendingVerifications,
      urgent: pendingVerifications > 10,
      icon: BadgeCheck,
    },
    {
      href: "/admin/moderation-cases",
      label: "Moderation cases",
      value: openCases,
      urgent: openCases > 0,
      icon: Gavel,
    },
    {
      href: "/admin/appeals",
      label: "Appeals",
      value: openAppeals,
      urgent: openAppeals > 0,
      icon: Scale,
    },
  ];

  // Modules the product does not have yet. Rendered as inert "Not
  // configured" cards (never a crash) so the dashboard is honest about
  // its coverage; wire a real model + queue page, then move the entry
  // up into `queues`.
  const notConfigured = [{ label: "Support inbox", icon: LifeBuoy }];

  return (
    <>
      <PageHeader title="Dashboard" description="Platform health at a glance." />

      <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
        Accounts
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {accountStats.map(({ label, value, sub, icon: Icon, href }) => (
          <Link
            key={label}
            href={href}
            className="focus-visible:ring-foreground/20 block h-full rounded-3xl focus-visible:ring-2 focus-visible:outline-none"
          >
            <Card className="hover:shadow-float h-full rounded-3xl transition-shadow">
              <CardHeader className="flex-row items-center justify-between pb-2">
                <CardTitle className="text-muted-foreground text-sm font-medium">{label}</CardTitle>
                <Icon className="text-muted-foreground size-4" aria-hidden="true" />
              </CardHeader>
              <CardContent>
                <p className="font-display text-3xl font-semibold tabular-nums">
                  {value.toLocaleString("en-IE")}
                </p>
                <p className="text-muted-foreground text-xs">{sub}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <h2 className="text-muted-foreground mt-8 mb-3 text-sm font-semibold tracking-wide uppercase">
        Activity
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {activityStats.map(({ label, value, sub, icon: Icon }) => (
          <Card key={label} className="rounded-3xl">
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium">{label}</CardTitle>
              <Icon className="text-muted-foreground size-4" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <p className="font-display text-3xl font-semibold tabular-nums">
                {value.toLocaleString("en-IE")}
              </p>
              <p className="text-muted-foreground text-xs">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <h2 className="text-muted-foreground mt-8 mb-3 text-sm font-semibold tracking-wide uppercase">
        Work queues
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {queues.map(({ href, label, value, urgent, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="focus-visible:ring-foreground/20 block rounded-3xl focus-visible:ring-2 focus-visible:outline-none"
          >
            <Card className="hover:shadow-float rounded-3xl transition-shadow">
              {/* flex-wrap: the urgency badge drops below on very narrow
                  screens (320px) instead of forcing page-level overflow. */}
              <CardContent className="flex flex-wrap items-center gap-4 py-5">
                <span className="bg-accent flex size-11 shrink-0 items-center justify-center rounded-2xl">
                  <Icon className="text-accent-foreground size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-muted-foreground text-sm">{label}</p>
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
        {notConfigured.map(({ label, icon: Icon }) => (
          <Card key={label} className="rounded-3xl border-dashed opacity-70">
            <CardContent className="flex items-center gap-4 py-5">
              <span className="bg-muted flex size-11 shrink-0 items-center justify-center rounded-2xl">
                <Icon className="text-muted-foreground size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-muted-foreground text-sm">{label}</p>
                <p className="text-muted-foreground text-sm">Not configured</p>
              </div>
              <Badge variant="outline" className="rounded-full">
                Planned
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* AWS Face Liveness production readiness (read-only; no secrets). */}
      <div className="mt-4 max-w-xl">
        <FaceReadinessCard />
      </div>
    </>
  );
}
