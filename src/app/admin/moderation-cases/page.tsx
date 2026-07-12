import type { Metadata } from "next";
import Link from "next/link";
import { Gavel, Search } from "lucide-react";
import { requireAdminPage } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import {
  countModerationCases,
  listModerationCases,
  type ModerationCaseFilter,
} from "@/lib/services/appeals";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Input } from "@/components/ui/input";
import { pretty } from "../safety-badges";
import { CaseList, type CaseRow } from "./case-list";

export const metadata: Metadata = { title: "Moderation cases" };
export const dynamic = "force-dynamic";

const STATUSES = ["OPEN", "UNDER_REVIEW", "APPEALED", "ACTION_TAKEN", "DISMISSED", "REVERSED"] as const;
const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

type CaseStatus = (typeof STATUSES)[number];
type Severity = (typeof SEVERITIES)[number];

type Filters = {
  status: CaseStatus | null;
  severity: Severity | null;
  priority: Severity | null;
  assigned: "me" | "unassigned" | null;
  overdue: boolean;
  q: string;
};

function filterHref(f: Filters): string {
  const params = new URLSearchParams();
  if (f.status) params.set("status", f.status);
  if (f.severity) params.set("severity", f.severity);
  if (f.priority) params.set("priority", f.priority);
  if (f.assigned) params.set("assigned", f.assigned);
  if (f.overdue) params.set("overdue", "1");
  if (f.q) params.set("q", f.q);
  const qs = params.toString();
  return qs ? `/admin/moderation-cases?${qs}` : "/admin/moderation-cases";
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex min-h-11 items-center rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 md:min-h-9",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

export default async function ModerationCasesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    severity?: string;
    priority?: string;
    assigned?: string;
    overdue?: string;
    q?: string;
  }>;
}) {
  const admin = await requireAdminPage();
  if (!admin) return null; // layout renders AccessDenied; keep segment payload empty
  const raw = await searchParams;

  const filters: Filters = {
    status: STATUSES.find((s) => s === raw.status) ?? null,
    severity: SEVERITIES.find((s) => s === raw.severity) ?? null,
    priority: SEVERITIES.find((s) => s === raw.priority) ?? null,
    assigned: raw.assigned === "me" || raw.assigned === "unassigned" ? raw.assigned : null,
    overdue: raw.overdue === "1",
    q: raw.q?.trim().slice(0, 200) ?? "",
  };

  const serviceFilter: ModerationCaseFilter = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.assigned === "me"
      ? { assignedToId: admin.id }
      : filters.assigned === "unassigned"
        ? { assignedToId: "unassigned" as const }
        : {}),
    ...(filters.overdue ? { overdueOnly: true } : {}),
    ...(filters.q ? { search: filters.q } : {}),
  };

  const [cases, total] = await Promise.all([
    listModerationCases({ ...serviceFilter, take: 100 }),
    countModerationCases(serviceFilter),
  ]);

  // Assignee chips need emails - one bounded lookup for the ids on screen.
  const assigneeIds = [...new Set(cases.map((c) => c.assignedToId).filter((id): id is string => !!id))];
  const assignees =
    assigneeIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: assigneeIds } },
          select: { id: true, email: true },
        })
      : [];
  const assigneeEmail = new Map(assignees.map((u) => [u.id, u.email]));

  const rows: CaseRow[] = cases.map((c) => ({
    id: c.id,
    caseType: c.caseType,
    status: c.status,
    severity: c.severity,
    priority: c.priority,
    source: c.source,
    summary: c.summary,
    createdAt: c.createdAt,
    slaDueAt: c.slaDueAt,
    resolvedAt: c.resolvedAt,
    isOverdue: c.isOverdue,
    assignedToId: c.assignedToId,
    assigneeEmail: c.assignedToId ? (assigneeEmail.get(c.assignedToId) ?? null) : null,
    violationCount: c.violations.length,
    user: {
      id: c.user.id,
      email: c.user.email,
      status: c.user.status,
      safetyRiskScore: c.user.safetyRiskScore,
    },
  }));

  return (
    <>
      <PageHeader
        title="Moderation cases"
        description={
          total > cases.length
            ? `Showing ${cases.length} of ${total} matching · most urgent first`
            : `${total} matching · most urgent first`
        }
      />

      {/* Search: user email, user id or case id - server-side. */}
      <form action="/admin/moderation-cases" method="GET" role="search" className="mb-4 flex max-w-md gap-2">
        {filters.status && <input type="hidden" name="status" value={filters.status} />}
        {filters.severity && <input type="hidden" name="severity" value={filters.severity} />}
        {filters.priority && <input type="hidden" name="priority" value={filters.priority} />}
        {filters.assigned && <input type="hidden" name="assigned" value={filters.assigned} />}
        {filters.overdue && <input type="hidden" name="overdue" value="1" />}
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Search user email, user id or case id"
            aria-label="Search cases by user email, user id or case id"
            className="h-11 rounded-full pl-10"
          />
        </div>
        {filters.q && (
          <Link
            href={filterHref({ ...filters, q: "" })}
            className="flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Filter by status">
        {[null, ...STATUSES].map((s) => (
          <Chip key={s ?? "all"} href={filterHref({ ...filters, status: s })} active={s === filters.status}>
            {s ? pretty(s) : "All statuses"}
          </Chip>
        ))}
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Filter by severity">
        {[null, ...SEVERITIES].map((s) => (
          <Chip key={s ?? "all"} href={filterHref({ ...filters, severity: s })} active={s === filters.severity}>
            {s ? pretty(s) : "All severities"}
          </Chip>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap gap-1.5" aria-label="Filter by priority, assignment and SLA">
        {[null, ...SEVERITIES].map((p) => (
          <Chip key={p ?? "all"} href={filterHref({ ...filters, priority: p })} active={p === filters.priority}>
            {p ? `prio ${pretty(p)}` : "All priorities"}
          </Chip>
        ))}
        <span aria-hidden="true" className="my-1.5 w-px self-stretch bg-border/60" />
        <Chip
          href={filterHref({ ...filters, assigned: filters.assigned === "me" ? null : "me" })}
          active={filters.assigned === "me"}
        >
          Assigned to me
        </Chip>
        <Chip
          href={filterHref({
            ...filters,
            assigned: filters.assigned === "unassigned" ? null : "unassigned",
          })}
          active={filters.assigned === "unassigned"}
        >
          Unassigned
        </Chip>
        <Chip href={filterHref({ ...filters, overdue: !filters.overdue })} active={filters.overdue}>
          Overdue only
        </Chip>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Gavel}
          title="Queue clear"
          description={
            filters.q
              ? `No cases match "${filters.q}" with these filters.`
              : "No moderation cases match these filters."
          }
          action={
            (filters.q ||
              filters.status ||
              filters.severity ||
              filters.priority ||
              filters.assigned ||
              filters.overdue) && (
              <Link
                href="/admin/moderation-cases"
                className="flex min-h-11 items-center rounded-full border px-5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
              >
                Clear search and filters
              </Link>
            )
          }
        />
      ) : (
        <CaseList rows={rows} meId={admin.id} now={new Date()} />
      )}
    </>
  );
}
