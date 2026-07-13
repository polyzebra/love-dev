import type { Metadata } from "next";
import { MonitorSmartphone, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { SettingsSubheader } from "@/components/settings/settings-subheader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Devices & sessions" };

export default async function DevicesSettingsPage() {
  const user = await requireUser();
  const devices = await db.device.findMany({
    where: { userId: user.id },
    orderBy: { lastSeenAt: "desc" },
  });

  return (
    <>
      <SettingsSubheader
        backHref="/settings"
        backLabel="Back to settings"
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
            <div className="bg-muted text-muted-foreground flex items-center gap-3 rounded-2xl px-4 py-6 text-sm">
              <MonitorSmartphone className="size-5" aria-hidden="true" />
              Device tracking activates on your next sign-in.
            </div>
          ) : (
            <ul className="divide-y">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-3.5">
                  <MonitorSmartphone
                    className="text-muted-foreground size-5 shrink-0"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.platform ?? "Unknown device"}</p>
                    <p className="text-muted-foreground text-sm">
                      Last active {formatAgo(d.lastSeenAt)}
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
