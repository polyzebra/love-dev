import type { Metadata } from "next";
import { MonitorSmartphone, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Devices & sessions" };
export const dynamic = "force-dynamic";

export default async function DevicesSettingsPage() {
  const user = await requireUser();
  const devices = await db.device.findMany({
    where: { userId: user.id },
    orderBy: { lastSeenAt: "desc" },
  });

  return (
    <>
      <PageHeader
        title="Devices"
        description="Everywhere your account is signed in."
      />

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-base">Recognised devices</CardTitle>
          <CardDescription>
            Trusted devices skip extra verification steps. If you don&apos;t recognise a device,
            change your password immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {devices.length === 0 ? (
            <div className="flex items-center gap-3 rounded-2xl bg-muted px-4 py-6 text-sm text-muted-foreground">
              <MonitorSmartphone className="size-5" aria-hidden="true" />
              Device tracking activates on your next sign-in.
            </div>
          ) : (
            <ul className="divide-y">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-3.5">
                  <MonitorSmartphone className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {d.platform ?? "Unknown device"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Last active {formatRelativeTime(d.lastSeenAt)} ago
                    </p>
                  </div>
                  {d.trusted && (
                    <Badge variant="secondary" className="rounded-full">
                      <ShieldCheck className="size-3" /> Trusted
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
