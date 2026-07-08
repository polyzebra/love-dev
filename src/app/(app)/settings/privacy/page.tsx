import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteAccountButton, ExportDataButton } from "@/components/app/privacy-actions";

export const metadata: Metadata = { title: "Privacy Centre" };
export const dynamic = "force-dynamic";

export default async function PrivacySettingsPage() {
  const user = await requireUser();
  const blocks = await db.block.findMany({
    where: { blockerId: user.id },
    include: { blocked: { select: { profile: { select: { displayName: true } } } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <PageHeader
        title="Privacy Centre"
        description="Your data, your rules - as GDPR intended."
      />

      <div className="space-y-6">
        <Card className="rounded-3xl">
          <CardHeader>
            <CardTitle className="text-base">Blocked members</CardTitle>
            <CardDescription>
              Blocked members can&apos;t see you or contact you anywhere on Tirvea.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {blocks.length === 0 ? (
              <p className="text-sm text-muted-foreground">You haven&apos;t blocked anyone.</p>
            ) : (
              <ul className="divide-y">
                {blocks.map((b) => (
                  <li key={b.id} className="flex items-center justify-between py-3 text-sm">
                    <span className="font-medium">
                      {b.blocked.profile?.displayName ?? "Member"}
                    </span>
                    <span className="text-muted-foreground">
                      Blocked {b.createdAt.toLocaleDateString("en-IE")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-3xl">
          <CardHeader>
            <CardTitle className="text-base">Export your data</CardTitle>
            <CardDescription>
              Download a copy of everything Tirvea holds about you - profile, activity, messages and
              payments - as JSON. (GDPR Art. 20)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ExportDataButton />
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Delete your account</CardTitle>
            <CardDescription>
              Permanent, with a 30-day grace period. All personal data is erased. (GDPR Art. 17)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeleteAccountButton />
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Questions? Read our{" "}
          <Link href="/legal/privacy" className="underline underline-offset-2">
            Privacy Policy
          </Link>{" "}
          or email privacy@tirvea.app
        </p>
      </div>
    </>
  );
}
