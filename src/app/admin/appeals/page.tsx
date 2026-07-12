import type { Metadata } from "next";
import Link from "next/link";
import { Scale } from "lucide-react";
import { requireAdminPage } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { OPEN_APPEAL_STATUSES, listAppeals } from "@/lib/services/appeals";
import type { AppealStatus } from "@/generated/prisma/enums";
import { cn, formatAgo } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import {
  ACCOUNT_STATUS_BADGE,
  APPEAL_STATUS_BADGE,
  ENFORCEMENT_BADGE,
  pretty,
} from "../safety-badges";
import { AppealActions } from "./appeal-actions";

export const metadata: Metadata = { title: "Appeals" };
export const dynamic = "force-dynamic";

const ALL_STATUSES: AppealStatus[] = [
  "SUBMITTED",
  "PENDING_REVIEW",
  "UNDER_REVIEW",
  "NEEDS_INFO",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "WITHDRAWN",
];

const FILTERS = [
  { key: "open", label: "Open" },
  ...ALL_STATUSES.map((s) => ({ key: s, label: pretty(s) })),
  { key: "all", label: "All" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

const EVENT_LABEL: Record<string, string> = {
  submitted: "submitted",
  under_review: "review started",
  needs_info_requested: "asked for info",
  user_responded: "user replied",
  approved: "approved",
  rejected: "rejected",
  withdrawn: "withdrawn by user",
  expired: "expired (no reply)",
};

function Timeline({
  events,
}: {
  events: { type: string; actorRole: string; note: string | null; createdAt: Date }[];
}) {
  if (events.length === 0) return null;
  return (
    <ol aria-label="Appeal timeline" className="mt-3 space-y-1.5 border-l pl-4">
      {events.map((e, i) => (
        <li key={`${e.type}-${i}`} className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{EVENT_LABEL[e.type] ?? e.type}</span>
          {" · "}
          {e.actorRole.toLowerCase()} · {formatAgo(e.createdAt)}
          {e.note && (
            <span className="mt-0.5 block rounded-xl bg-muted px-3 py-1.5 text-xs leading-relaxed text-foreground">
              {e.note}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export default async function AdminAppealsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  if (!(await requireAdminPage())) return null; // layout renders AccessDenied; keep segment payload empty
  const { status: rawStatus } = await searchParams;
  const filter: FilterKey = FILTERS.some((f) => f.key === rawStatus)
    ? (rawStatus as FilterKey)
    : "open";

  // "Open" = everything still awaiting an outcome (submitted, under
  // review, waiting on the user) - the service orders oldest first.
  const appeals =
    filter === "open"
      ? await listAppeals({ statuses: [...OPEN_APPEAL_STATUSES] })
      : filter === "all"
        ? await listAppeals({})
        : await listAppeals({ status: filter as AppealStatus });

  // The queue links each appeal to its moderation case when one exists.
  const caseIds = appeals
    .map((a) => a.violation.moderationCaseId)
    .filter((id): id is string => !!id);
  const cases =
    caseIds.length > 0
      ? await db.moderationCase.findMany({
          where: { id: { in: caseIds } },
          select: { id: true },
        })
      : [];
  const caseExists = new Set(cases.map((c) => c.id));

  return (
    <>
      <PageHeader title="Appeals" description={`${appeals.length} shown · oldest first`} />

      <div className="mb-5 flex flex-wrap gap-1.5" aria-label="Filter appeals by status">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "open" ? "/admin/appeals" : `/admin/appeals?status=${f.key}`}
            aria-current={f.key === filter ? "true" : undefined}
            className={cn(
              "flex min-h-11 items-center rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 md:min-h-9",
              f.key === filter
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {appeals.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="Queue clear"
          description="No appeals match this filter. New appeals land here the moment they are submitted."
        />
      ) : (
        <div className="space-y-3">
          {appeals.map((appeal) => {
            const open = (OPEN_APPEAL_STATUSES as readonly string[]).includes(appeal.status);
            return (
              <div key={appeal.id} className="rounded-3xl border bg-card p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={APPEAL_STATUS_BADGE[appeal.status] ?? "outline"}
                    className="rounded-full"
                  >
                    {pretty(appeal.status)}
                  </Badge>
                  <Badge
                    variant={ENFORCEMENT_BADGE[appeal.violation.actionTaken] ?? "outline"}
                    className="rounded-full"
                  >
                    {pretty(appeal.violation.actionTaken)}
                  </Badge>
                  <span className="text-sm font-medium">
                    {pretty(appeal.violation.violationType)}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    submitted {formatAgo(appeal.createdAt)}
                  </span>
                </div>

                <blockquote className="mt-3 rounded-2xl bg-muted px-4 py-3 text-sm italic">
                  &ldquo;{appeal.appealText}&rdquo;
                </blockquote>

                <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <div>
                    <dt className="inline font-semibold">User: </dt>
                    <dd className="inline">
                      <Link
                        href={`/admin/users/${appeal.user.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {appeal.user.email}
                      </Link>{" "}
                      <Badge
                        variant={ACCOUNT_STATUS_BADGE[appeal.user.status] ?? "outline"}
                        className="rounded-full align-middle"
                      >
                        {pretty(appeal.user.status)}
                      </Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold">User was told: </dt>
                    <dd className="inline">{appeal.violation.userVisibleReason}</dd>
                  </div>
                  {appeal.violation.internalReason && (
                    <div>
                      <dt className="inline font-semibold">Internal reason: </dt>
                      <dd className="inline">{appeal.violation.internalReason}</dd>
                    </div>
                  )}
                  {appeal.adminNotes && (
                    <div>
                      <dt className="inline font-semibold">Decision notes (staff-only): </dt>
                      <dd className="inline">{appeal.adminNotes}</dd>
                    </div>
                  )}
                </dl>

                <Timeline events={appeal.events} />

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {open && <AppealActions appealId={appeal.id} status={appeal.status} />}
                  {appeal.status === "NEEDS_INFO" && (
                    <span className="text-xs text-muted-foreground">
                      Waiting on the user&apos;s reply - it can still be decided now.
                    </span>
                  )}
                  {appeal.violation.moderationCaseId &&
                    caseExists.has(appeal.violation.moderationCaseId) && (
                      <Link
                        href={`/admin/moderation-cases/${appeal.violation.moderationCaseId}`}
                        className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
                      >
                        View case
                      </Link>
                    )}
                  <Link
                    href={`/admin/users/${appeal.user.id}`}
                    className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
                  >
                    View user
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
