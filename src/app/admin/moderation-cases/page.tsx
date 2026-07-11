import type { Metadata } from "next";
import Link from "next/link";
import { Gavel } from "lucide-react";
import { requireAdminPage } from "@/lib/auth/require-user";
import { listModerationCases } from "@/lib/services/appeals";
import { cn, formatRelativeTime } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "Moderation cases" };
export const dynamic = "force-dynamic";

const STATUSES = ["OPEN", "UNDER_REVIEW", "APPEALED", "ACTION_TAKEN", "DISMISSED", "REVERSED"] as const;
const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

type CaseStatus = (typeof STATUSES)[number];
type Severity = (typeof SEVERITIES)[number];

const SEVERITY_BADGE: Record<Severity, "destructive" | "default" | "secondary" | "outline"> = {
  CRITICAL: "destructive",
  HIGH: "default",
  MEDIUM: "secondary",
  LOW: "outline",
};

const STATUS_BADGE: Record<CaseStatus, "destructive" | "default" | "secondary" | "outline"> = {
  OPEN: "default",
  UNDER_REVIEW: "secondary",
  APPEALED: "destructive",
  ACTION_TAKEN: "outline",
  DISMISSED: "outline",
  REVERSED: "outline",
};

function pretty(value: string): string {
  return value.toLowerCase().replace(/_/g, " ");
}

function filterHref(status: CaseStatus | null, severity: Severity | null): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (severity) params.set("severity", severity);
  const qs = params.toString();
  return qs ? `/admin/moderation-cases?${qs}` : "/admin/moderation-cases";
}

export default async function ModerationCasesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; severity?: string }>;
}) {
  if (!(await requireAdminPage())) return null; // layout renders AccessDenied; keep segment payload empty
  const { status: rawStatus, severity: rawSeverity } = await searchParams;

  const status = STATUSES.find((s) => s === rawStatus) ?? null;
  const severity = SEVERITIES.find((s) => s === rawSeverity) ?? null;

  const cases = await listModerationCases({
    ...(status ? { status } : {}),
    ...(severity ? { severity } : {}),
    take: 100,
  });

  return (
    <>
      <PageHeader
        title="Moderation cases"
        description={`${cases.length} shown · most urgent first`}
      />

      <div className="mb-2 flex flex-wrap gap-1.5">
        {[null, ...STATUSES].map((s) => (
          <Link
            key={s ?? "all"}
            href={filterHref(s, severity)}
            className={cn(
              "flex min-h-9 items-center rounded-full px-4 text-sm font-medium transition-colors",
              s === status
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {s ? pretty(s) : "All statuses"}
          </Link>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap gap-1.5">
        {[null, ...SEVERITIES].map((s) => (
          <Link
            key={s ?? "all"}
            href={filterHref(status, s)}
            className={cn(
              "flex min-h-9 items-center rounded-full px-4 text-sm font-medium transition-colors",
              s === severity
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {s ? pretty(s) : "All severities"}
          </Link>
        ))}
      </div>

      {cases.length === 0 ? (
        <EmptyState
          icon={Gavel}
          title="Queue clear"
          description="No moderation cases match these filters."
        />
      ) : (
        <div className="space-y-3">
          {cases.map((c) => (
            <Link key={c.id} href={`/admin/moderation-cases/${c.id}`} className="block">
              <div className="rounded-3xl border bg-card p-5 transition-shadow hover:shadow-float">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={SEVERITY_BADGE[c.severity]} className="rounded-full">
                    {pretty(c.severity)}
                  </Badge>
                  <Badge variant={STATUS_BADGE[c.status]} className="rounded-full">
                    {pretty(c.status)}
                  </Badge>
                  <span className="text-sm font-medium">{pretty(c.caseType)}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatRelativeTime(c.createdAt)} ago · {pretty(c.source)}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{c.summary}</p>
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="truncate font-medium text-foreground">{c.user.email}</span>
                  <span>account {pretty(c.user.status)}</span>
                  <span>risk {c.user.safetyRiskScore}</span>
                  {c.violations.length > 0 && (
                    <span>
                      {c.violations.length} linked action{c.violations.length === 1 ? "" : "s"}
                    </span>
                  )}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
