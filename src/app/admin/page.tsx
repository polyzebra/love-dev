import Link from "next/link";
import { ArrowUpRight, BadgeCheck, Flag, HeartHandshake, MessageSquare, Users } from "lucide-react";
import { db } from "@/lib/db";
import { daysAgo } from "@/lib/presence";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const dayAgo = daysAgo(1);
  const weekAgo = daysAgo(7);

  const [
    totalUsers,
    newUsersWeek,
    activeToday,
    totalMatches,
    messagesToday,
    openReports,
    pendingVerifications,
    paidSubscriptions,
  ] = await Promise.all([
    db.user.count({ where: { status: { not: "DELETED" } } }),
    db.user.count({ where: { createdAt: { gte: weekAgo } } }),
    db.user.count({ where: { lastActiveAt: { gte: dayAgo } } }),
    db.match.count({ where: { status: "ACTIVE" } }),
    db.message.count({ where: { createdAt: { gte: dayAgo } } }),
    db.report.count({ where: { status: "OPEN" } }),
    db.verification.count({ where: { status: { in: ["PENDING", "IN_REVIEW"] }, type: { in: ["PHOTO", "IDENTITY"] } } }),
    db.subscription.count({ where: { tier: { not: "FREE" }, status: "ACTIVE" } }),
  ]);

  const stats = [
    { label: "Members", value: totalUsers, sub: `+${newUsersWeek} this week`, icon: Users },
    { label: "Active today", value: activeToday, sub: "last 24 hours", icon: HeartHandshake },
    { label: "Active matches", value: totalMatches, sub: "all time", icon: BadgeCheck },
    { label: "Messages today", value: messagesToday, sub: "last 24 hours", icon: MessageSquare },
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
      href: "/admin/verification",
      label: "Verification queue",
      value: pendingVerifications,
      urgent: pendingVerifications > 10,
      icon: BadgeCheck,
    },
    {
      href: "/admin/payments",
      label: "Paying members",
      value: paidSubscriptions,
      urgent: false,
      icon: Users,
    },
  ];

  return (
    <>
      <PageHeader title="Dashboard" description="Platform health at a glance." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(({ label, value, sub, icon: Icon }) => (
          <Card key={label} className="rounded-3xl">
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <p className="font-display text-3xl font-semibold tabular-nums">{value.toLocaleString("en-IE")}</p>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Work queues
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {queues.map(({ href, label, value, urgent, icon: Icon }) => (
          <Link key={href} href={href}>
            <Card className="rounded-3xl transition-shadow hover:shadow-float">
              <CardContent className="flex items-center gap-4 py-5">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-accent">
                  <Icon className="size-5 text-accent-foreground" aria-hidden="true" />
                </span>
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="text-2xl font-semibold tabular-nums">{value}</p>
                </div>
                {urgent && <Badge variant="destructive" className="rounded-full">Needs attention</Badge>}
                <ArrowUpRight className="size-4 text-muted-foreground" aria-hidden="true" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
