import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { PLANS } from "@/lib/constants";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Subscription & billing" };
export const dynamic = "force-dynamic";

export default async function SubscriptionSettingsPage() {
  const user = await requireUser();
  const [subscription, payments] = await Promise.all([
    db.subscription.findUnique({ where: { userId: user.id } }),
    db.payment.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
  ]);

  const tier = subscription?.tier ?? "FREE";
  const plan = PLANS.find((p) => p.tier === tier) ?? PLANS[0];

  return (
    <>
      <PageHeader title="Subscription" description="Your plan, invoices and receipts." />

      <Card className="mb-6 rounded-3xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Current plan</CardTitle>
            <Badge variant={tier === "FREE" ? "secondary" : "default"} className="rounded-full px-3">
              {plan.name}
            </Badge>
          </div>
          <CardDescription>
            {tier === "FREE"
              ? "You're on the free plan."
              : subscription?.cancelAtPeriodEnd
                ? `Cancels at the end of the current period${subscription.currentPeriodEnd ? ` (${subscription.currentPeriodEnd.toLocaleDateString("en-IE")})` : ""}.`
                : subscription?.currentPeriodEnd
                  ? `Renews on ${subscription.currentPeriodEnd.toLocaleDateString("en-IE")}.`
                  : plan.tagline}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button className="rounded-full" asChild>
            <Link href="/pricing">{tier === "FREE" ? "Upgrade" : "Change plan"}</Link>
          </Button>
          {tier !== "FREE" && (
            <Button variant="outline" className="rounded-full">
              Manage billing
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-base">Payment history</CardTitle>
          <CardDescription>Receipts are also emailed after every payment.</CardDescription>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <div className="flex items-center gap-3 rounded-2xl bg-muted px-4 py-6 text-sm text-muted-foreground">
              <Receipt className="size-5" aria-hidden="true" />
              No payments yet.
            </div>
          ) : (
            <ul className="divide-y">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium">{p.description ?? "Subscription"}</p>
                    <p className="text-muted-foreground">
                      {p.createdAt.toLocaleDateString("en-IE", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums">
                      €{(p.amountCents / 100).toFixed(2)}
                    </span>
                    <Badge
                      variant={p.status === "SUCCEEDED" ? "secondary" : "destructive"}
                      className="rounded-full"
                    >
                      {p.status.toLowerCase()}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
