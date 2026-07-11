import type { Metadata } from "next";
import Link from "next/link";
import { Scale } from "lucide-react";
import { requireAdminPage } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { listAppeals } from "@/lib/services/appeals";
import type { AppealStatus } from "@/generated/prisma/enums";
import { cn, formatRelativeTime } from "@/lib/utils";
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

const FILTERS = [
  { key: "open", label: "Needs decision" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "all", label: "All" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

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

  // "Needs decision" = SUBMITTED + PENDING_REVIEW; the service filters one
  // status at a time, so the open queue merges both (oldest first, as the
  // service orders).
  const appeals =
    filter === "open"
      ? (
          await Promise.all([
            listAppeals({ status: "SUBMITTED" }),
            listAppeals({ status: "PENDING_REVIEW" }),
          ])
        )
          .flat()
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
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

      <div className="mb-5 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "open" ? "/admin/appeals" : `/admin/appeals?status=${f.key}`}
            className={cn(
              "flex min-h-9 items-center rounded-full px-4 text-sm font-medium transition-colors",
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
            const open = appeal.status === "SUBMITTED" || appeal.status === "PENDING_REVIEW";
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
                    submitted {formatRelativeTime(appeal.createdAt)} ago
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
                      <dt className="inline font-semibold">Decision notes: </dt>
                      <dd className="inline">{appeal.adminNotes}</dd>
                    </div>
                  )}
                </dl>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {open && <AppealActions appealId={appeal.id} />}
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
