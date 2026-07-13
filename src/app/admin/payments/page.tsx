import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { PLANS } from "@/lib/constants";
import { daysAgo } from "@/lib/presence";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PAYMENT_STATUS_BADGE, pretty } from "../safety-badges";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

export default async function AdminPaymentsPage() {
  if (!(await requireAdminPage())) return null; // layout renders AccessDenied; keep segment payload empty
  const monthAgo = daysAgo(30);

  const [payments, revenueAgg, plusCount, goldCount] = await Promise.all([
    db.payment.findMany({
      include: { user: { select: { email: true, profile: { select: { displayName: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.payment.aggregate({
      where: { status: "SUCCEEDED", createdAt: { gte: monthAgo } },
      _sum: { amountCents: true },
    }),
    db.subscription.count({ where: { tier: "PLUS", status: "ACTIVE" } }),
    db.subscription.count({ where: { tier: "GOLD", status: "ACTIVE" } }),
  ]);

  // ONE price source: monthly amounts come from the PLANS catalogue, the
  // same place the pricing UI and Stripe validation read.
  const monthlyCents = (tier: "PLUS" | "GOLD") =>
    PLANS.find((p) => p.tier === tier)?.priceMonthlyCents ?? 0;
  const mrrApprox = (plusCount * monthlyCents("PLUS") + goldCount * monthlyCents("GOLD")) / 100;

  return (
    <>
      <PageHeader title="Payments" description="Revenue and transactions." />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card className="rounded-3xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Revenue (30 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-3xl font-semibold tabular-nums">
              €{((revenueAgg._sum.amountCents ?? 0) / 100).toLocaleString("en-IE")}
            </p>
          </CardContent>
        </Card>
        <Card className="rounded-3xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">MRR (approx)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-3xl font-semibold tabular-nums">
              €{mrrApprox.toLocaleString("en-IE")}
            </p>
          </CardContent>
        </Card>
        <Card className="rounded-3xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active subscriptions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-3xl font-semibold tabular-nums">
              {plusCount + goldCount}
            </p>
            <p className="text-xs text-muted-foreground">
              {plusCount} Plus · {goldCount} Gold
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="overflow-x-auto rounded-3xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="max-w-56">
                  <p
                    className="truncate font-medium"
                    title={p.user.profile?.displayName ?? undefined}
                  >
                    {p.user.profile?.displayName ?? "-"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground" title={p.user.email}>
                    {p.user.email}
                  </p>
                </TableCell>
                <TableCell className="max-w-64">
                  <span className="block truncate text-sm" title={p.description ?? "Subscription"}>
                    {p.description ?? "Subscription"}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  €{(p.amountCents / 100).toFixed(2)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={PAYMENT_STATUS_BADGE[p.status] ?? "outline"}
                    className="rounded-full"
                  >
                    {pretty(p.status)}
                  </Badge>
                </TableCell>
                <TableCell
                  className="text-right text-sm tabular-nums text-muted-foreground"
                  title={p.createdAt.toLocaleString("en-IE")}
                >
                  {p.createdAt.toLocaleDateString("en-IE")}
                </TableCell>
              </TableRow>
            ))}
            {payments.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No payments yet. They&apos;ll appear here once Stripe webhooks are configured.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
