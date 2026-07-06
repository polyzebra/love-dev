import type { Metadata } from "next";
import { db } from "@/lib/db";
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

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

export default async function AdminPaymentsPage() {
  const monthAgo = daysAgo(30);

  const [payments, revenueAgg, plusCount, premiumCount] = await Promise.all([
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
    db.subscription.count({ where: { tier: "PREMIUM", status: "ACTIVE" } }),
  ]);

  const mrrApprox = (plusCount * 1499 + premiumCount * 2999) / 100;

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
              {plusCount + premiumCount}
            </p>
            <p className="text-xs text-muted-foreground">
              {plusCount} Plus · {premiumCount} Premium
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
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <p className="font-medium">{p.user.profile?.displayName ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{p.user.email}</p>
                </TableCell>
                <TableCell className="text-sm">{p.description ?? "Subscription"}</TableCell>
                <TableCell className="tabular-nums">€{(p.amountCents / 100).toFixed(2)}</TableCell>
                <TableCell>
                  <Badge
                    variant={p.status === "SUCCEEDED" ? "secondary" : "destructive"}
                    className="rounded-full"
                  >
                    {p.status.toLowerCase()}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
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
