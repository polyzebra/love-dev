import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ReportActions } from "./report-actions";
import { formatRelativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const REASON_LABELS: Record<string, string> = {
  FAKE_PROFILE: "Fake profile",
  INAPPROPRIATE_CONTENT: "Inappropriate content",
  HARASSMENT: "Harassment",
  SPAM: "Spam",
  SCAM: "Scam",
  UNDERAGE: "Underage",
  OFFLINE_BEHAVIOUR: "Offline behaviour",
  OTHER: "Other",
};

const SEVERE = new Set(["UNDERAGE", "SCAM", "HARASSMENT"]);

export default async function AdminReportsPage() {
  const reports = await db.report.findMany({
    where: { status: { in: ["OPEN", "IN_REVIEW"] } },
    include: {
      reporter: { select: { email: true, profile: { select: { displayName: true } } } },
      reported: {
        select: {
          id: true,
          email: true,
          status: true,
          profile: { select: { displayName: true } },
          _count: { select: { reportsReceived: true } },
        },
      },
      message: { select: { body: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  if (reports.length === 0) {
    return (
      <>
        <PageHeader title="Reports" description="User reports awaiting review." />
        <EmptyState
          icon={Inbox}
          title="Queue clear"
          description="No open reports. Nice work keeping the community safe."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Reports" description={`${reports.length} awaiting review · oldest first`} />
      <div className="space-y-4">
        {reports.map((report) => (
          <Card key={report.id} className="rounded-3xl">
            <CardContent className="space-y-3 py-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={SEVERE.has(report.reason) ? "destructive" : "secondary"}
                  className="rounded-full"
                >
                  {REASON_LABELS[report.reason]}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formatRelativeTime(report.createdAt)} ago
                </span>
                {report.reported._count.reportsReceived > 1 && (
                  <Badge variant="outline" className="rounded-full">
                    {report.reported._count.reportsReceived} total reports on this user
                  </Badge>
                )}
              </div>

              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <p>
                  <span className="text-muted-foreground">Reported: </span>
                  <span className="font-medium">
                    {report.reported.profile?.displayName ?? report.reported.email}
                  </span>{" "}
                  <span className="text-muted-foreground">({report.reported.status.toLowerCase()})</span>
                </p>
                <p>
                  <span className="text-muted-foreground">By: </span>
                  {report.reporter.profile?.displayName ?? report.reporter.email}
                </p>
              </div>

              {report.message?.body && (
                <blockquote className="rounded-2xl bg-muted px-4 py-3 text-sm italic">
                  “{report.message.body}”
                </blockquote>
              )}
              {report.details && (
                <p className="text-sm text-muted-foreground">{report.details}</p>
              )}

              <ReportActions reportId={report.id} reportedUserId={report.reported.id} />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
