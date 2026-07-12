import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgeCheck, CircleDashed } from "lucide-react";
import { requireAdminPage } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { isCaseOverdue } from "@/lib/services/trust-safety";
import { calculateAge, formatAgo, formatRelativeTime } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import {
  ACCOUNT_STATUS_BADGE,
  APPEAL_STATUS_BADGE,
  CASE_STATUS_BADGE,
  ENFORCEMENT_BADGE,
  SEVERITY_BADGE,
  pretty,
} from "../../safety-badges";
import { AssignControl } from "./assign-control";
import { CaseActions } from "./case-actions";

export const metadata: Metadata = { title: "Case detail" };
export const dynamic = "force-dynamic";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border bg-card p-5">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function Stamp({ done, label }: { done: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      {done ? (
        <BadgeCheck className="size-4 text-success" aria-hidden="true" />
      ) : (
        <CircleDashed className="size-4 text-muted-foreground/50" aria-hidden="true" />
      )}
      {label}
    </span>
  );
}

function score(value: number | null | undefined): string {
  return value == null ? "-" : value.toFixed(2);
}

/** "3h" / "2d 4h" for SLA spans (formatRelativeTime is past-only). */
function formatSpan(ms: number): string {
  const totalHours = Math.max(0, Math.round(Math.abs(ms) / 3_600_000));
  if (totalHours < 1) return "under 1h";
  if (totalHours < 48) return `${totalHours}h`;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

export default async function ModerationCaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = await requireAdminPage();
  if (!admin) return null; // layout renders AccessDenied; keep segment payload empty

  const kase = await db.moderationCase.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          createdAt: true,
          lastActiveAt: true,
          emailVerified: true,
          phoneVerifiedAt: true,
          photoVerifiedAt: true,
          safetyRiskScore: true,
          safetyRiskReasons: true,
          safetyRecommendedAction: true,
          safetyRiskUpdatedAt: true,
          scamScore: true,
          riskScore: true,
          profile: {
            select: { displayName: true, birthDate: true, city: true, country: true },
          },
          photos: {
            orderBy: [{ isCover: "desc" }, { position: "asc" }],
            select: { id: true, status: true, moderation: true },
          },
          violations: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              actionTaken: true,
              violationType: true,
              internalReason: true,
              createdAt: true,
              expiresAt: true,
              reversedAt: true,
              moderationCaseId: true,
              appeals: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { id: true, status: true },
              },
            },
          },
          reportsReceived: {
            orderBy: { createdAt: "desc" },
            take: 5,
            select: { id: true, reason: true, details: true, status: true, createdAt: true },
          },
        },
      },
    },
  });
  if (!kase) notFound();

  const [report, moderationResult, staff, assignee] = await Promise.all([
    kase.reportId
      ? db.report.findUnique({
          where: { id: kase.reportId },
          select: { id: true, reason: true, details: true, status: true, createdAt: true },
        })
      : null,
    kase.photoId
      ? db.photoModerationResult.findFirst({
          where: { photoId: kase.photoId },
          orderBy: { createdAt: "desc" },
        })
      : null,
    // Staff picker options for the assignment control - small by nature.
    db.user.findMany({
      where: { role: { in: ["MODERATOR", "ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
      orderBy: { email: "asc" },
      take: 50,
      select: { id: true, email: true, role: true },
    }),
    kase.assignedToId
      ? db.user.findUnique({ where: { id: kase.assignedToId }, select: { email: true } })
      : null,
  ]);

  const nowMs = new Date().getTime();
  const user = kase.user;
  const casePhoto = kase.photoId ? user.photos.find((p) => p.id === kase.photoId) : null;
  const caseViolations = user.violations.filter((v) => v.moderationCaseId === kase.id);
  const reversible = caseViolations.find((v) => !v.reversedAt) ?? null;
  const age = user.profile?.birthDate ? calculateAge(user.profile.birthDate) : null;
  const riskReasons = user.safetyRiskReasons
    ? user.safetyRiskReasons.split(",").filter(Boolean)
    : [];
  const evidence = Array.isArray(kase.evidence) ? kase.evidence : kase.evidence ? [kase.evidence] : [];

  return (
    <>
      <Link
        href="/admin/moderation-cases"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Moderation cases
      </Link>
      <PageHeader
        title={`${pretty(kase.caseType)} case`}
        description={`id ${kase.id} · opened ${formatAgo(kase.createdAt)}`}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge variant={SEVERITY_BADGE[kase.severity] ?? "outline"} className="rounded-full">
          {pretty(kase.severity)}
        </Badge>
        <Badge variant={CASE_STATUS_BADGE[kase.status] ?? "outline"} className="rounded-full">
          {pretty(kase.status)}
        </Badge>
        {kase.priority !== kase.severity && (
          <Badge variant={SEVERITY_BADGE[kase.priority] ?? "outline"} className="rounded-full">
            priority {pretty(kase.priority)}
          </Badge>
        )}
        {isCaseOverdue(kase) && (
          <Badge variant="destructive" className="rounded-full">
            OVERDUE
          </Badge>
        )}
        <Badge variant="outline" className="rounded-full">
          source: {pretty(kase.source)}
        </Badge>
        {kase.confidence != null && (
          <Badge variant="outline" className="rounded-full tabular-nums">
            confidence {kase.confidence.toFixed(2)}
          </Badge>
        )}
      </div>

      <div className="mb-5">
        <CaseActions
          caseId={kase.id}
          userId={user.id}
          caseStatus={kase.status}
          violationType={kase.caseType}
          photoId={kase.photoId}
          photoRemovable={!!casePhoto && casePhoto.moderation !== "REJECTED"}
          reversibleViolationId={reversible?.id ?? null}
          userStatus={user.status}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Assignment">
          <AssignControl
            caseId={kase.id}
            assignedToId={kase.assignedToId}
            assigneeEmail={assignee?.email ?? null}
            meId={admin.id}
            staff={staff}
            canManage={hasPermission(admin.role, "safety:manage")}
            caseOpen={
              kase.status === "OPEN" || kase.status === "UNDER_REVIEW" || kase.status === "APPEALED"
            }
          />
        </Section>

        <Section title="SLA">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Field label="Opened">{formatAgo(kase.createdAt)}</Field>
            <Field label="Response due">
              {kase.slaDueAt ? (
                <>
                  {kase.slaDueAt.getTime() < nowMs
                    ? `${formatSpan(nowMs - kase.slaDueAt.getTime())} ago`
                    : `in ${formatSpan(kase.slaDueAt.getTime() - nowMs)}`}
                  {isCaseOverdue(kase) && (
                    <Badge variant="destructive" className="ml-2 rounded-full align-middle">
                      overdue
                    </Badge>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">no deadline recorded</span>
              )}
            </Field>
            <Field label="First response">
              {kase.firstResponseAt ? (
                `${formatAgo(kase.firstResponseAt)}`
              ) : (
                <span className="text-muted-foreground">not yet</span>
              )}
            </Field>
            <Field label="Resolved">
              {kase.resolvedAt ? (
                `${formatAgo(kase.resolvedAt)}`
              ) : (
                <span className="text-muted-foreground">open</span>
              )}
            </Field>
            <Field label="Escalated">
              {kase.escalatedAt ? (
                `${formatAgo(kase.escalatedAt)} (priority bumped)`
              ) : (
                <span className="text-muted-foreground">never</span>
              )}
            </Field>
            <Field label="Last activity">{formatAgo(kase.lastActivityAt)}</Field>
          </dl>
        </Section>

        <Section title="Case">
          <dl className="space-y-3">
            <Field label="Summary">{kase.summary}</Field>
            {kase.decisionReason && <Field label="Decision reason">{kase.decisionReason}</Field>}
            {kase.reviewedAt && (
              <Field label="Reviewed">{formatAgo(kase.reviewedAt)}</Field>
            )}
          </dl>
        </Section>

        <Section title="User">
          <dl className="space-y-3">
            <Field label="Profile">
              <Link href={`/admin/users/${user.id}`} className="font-medium hover:underline">
                {user.profile?.displayName ?? user.name ?? user.email}
              </Link>
              {age != null ? `, ${age}` : ""}
              {user.profile?.city ? ` · ${user.profile.city}` : ""}
              {user.profile?.country ? ` (${user.profile.country})` : ""}
            </Field>
            <Field label="Email">{user.email}</Field>
            <Field label="Account">
              <Badge variant={ACCOUNT_STATUS_BADGE[user.status] ?? "outline"} className="rounded-full">
                {pretty(user.status)}
              </Badge>
            </Field>
            <Field label="Verification">
              <span className="flex flex-wrap gap-3">
                <Stamp done={!!user.emailVerified} label="email" />
                <Stamp done={!!user.phoneVerifiedAt} label="phone" />
                <Stamp done={!!user.photoVerifiedAt} label="photo" />
              </span>
            </Field>
            <Field label="History">
              member {formatRelativeTime(user.createdAt)} · last active{" "}
              {user.lastActiveAt ? `${formatAgo(user.lastActiveAt)}` : "-"} ·{" "}
              {user.reportsReceived.length} recent report
              {user.reportsReceived.length === 1 ? "" : "s"}
            </Field>
          </dl>
        </Section>

        <Section title="Risk signals">
          <dl className="space-y-3">
            <Field label="Safety risk score">
              <span className="font-display text-2xl font-semibold tabular-nums">
                {user.safetyRiskScore}
              </span>
              <span className="text-muted-foreground"> / 100</span>
              {user.safetyRiskUpdatedAt && (
                <span className="ml-2 text-xs text-muted-foreground">
                  updated {formatAgo(user.safetyRiskUpdatedAt)}
                </span>
              )}
            </Field>
            <Field label="Recommended action">
              {user.safetyRecommendedAction ? pretty(user.safetyRecommendedAction) : "-"}
            </Field>
            <Field label="Signals">
              {riskReasons.length === 0 ? (
                <span className="text-muted-foreground">none on file</span>
              ) : (
                <span className="flex flex-wrap gap-1.5">
                  {riskReasons.map((reason) => (
                    <span
                      key={reason}
                      className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium"
                    >
                      {reason}
                    </span>
                  ))}
                </span>
              )}
            </Field>
            <Field label="Other engines">
              login risk {user.riskScore} · scam score {user.scamScore}
            </Field>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            Recompute lives on the{" "}
            <Link href={`/admin/users/${user.id}`} className="underline underline-offset-2">
              user page
            </Link>
            .
          </p>
        </Section>

        <Section title={kase.photoId ? "Photo under review" : "Photos"}>
          {kase.photoId && (
            <div className="mb-4 flex items-start gap-4">
              {/* Plain img via the staff-access media proxy - private bytes,
                  never next/image-cached. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/media/${kase.photoId}/thumb`}
                alt="Photo under review"
                loading="lazy"
                className="h-40 w-32 shrink-0 rounded-2xl border object-cover"
              />
              <dl className="min-w-0 flex-1 space-y-2 text-sm">
                <Field label="Photo state">
                  {casePhoto ? `${pretty(casePhoto.status)} · moderation ${pretty(casePhoto.moderation)}` : "deleted by owner"}
                </Field>
                {moderationResult ? (
                  <Field label={`Moderation scores (${moderationResult.provider})`}>
                    <span className="grid grid-cols-2 gap-x-4 gap-y-0.5 tabular-nums">
                      <span>adult {score(moderationResult.adultScore)}</span>
                      <span>violence {score(moderationResult.violenceScore)}</span>
                      <span>minor risk {score(moderationResult.minorRiskScore)}</span>
                      <span>AI-generated {score(moderationResult.aiGeneratedScore)}</span>
                      <span>duplicate {score(moderationResult.duplicateMatchScore)}</span>
                      <span>reverse-image {score(moderationResult.reverseImageRisk)}</span>
                      <span>faces {moderationResult.faceCount ?? "-"}</span>
                      <span>confidence {score(moderationResult.confidence)}</span>
                    </span>
                  </Field>
                ) : (
                  <p className="text-xs text-muted-foreground">No moderation result on file.</p>
                )}
              </dl>
            </div>
          )}
          {user.photos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No photos on the profile.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {user.photos.map((p) => (
                <figure key={p.id} className="w-20">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/media/${p.id}/thumb`}
                    alt={`Profile photo (${pretty(p.status)})`}
                    loading="lazy"
                    className={`h-24 w-20 rounded-xl border object-cover ${
                      p.id === kase.photoId ? "ring-2 ring-primary" : ""
                    }`}
                  />
                  <figcaption className="mt-0.5 truncate text-center text-[10px] text-muted-foreground">
                    {pretty(p.moderation)}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </Section>

        <Section title="Linked reports">
          {!report && user.reportsReceived.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reports linked to this user.</p>
          ) : (
            <ul className="space-y-3">
              {report && (
                <li className="rounded-2xl bg-muted px-4 py-3 text-sm">
                  <p className="font-medium">
                    Case report · {pretty(report.reason)} · {pretty(report.status)}
                  </p>
                  {report.details && <p className="mt-1 italic">&ldquo;{report.details}&rdquo;</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatAgo(report.createdAt)}
                  </p>
                </li>
              )}
              {user.reportsReceived
                .filter((r) => r.id !== report?.id)
                .map((r) => (
                  <li key={r.id} className="text-sm">
                    <p>
                      {pretty(r.reason)} ·{" "}
                      <span className="text-muted-foreground">{pretty(r.status)}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatAgo(r.createdAt)}
                    </p>
                  </li>
                ))}
            </ul>
          )}
        </Section>

        <Section title="Violations on file">
          {user.violations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No violations on file.</p>
          ) : (
            <ul className="divide-y">
              {user.violations.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <Badge variant={ENFORCEMENT_BADGE[v.actionTaken] ?? "outline"} className="rounded-full">
                    {pretty(v.actionTaken)}
                  </Badge>
                  <span className="text-sm">{pretty(v.violationType)}</span>
                  {v.moderationCaseId === kase.id && (
                    <Badge variant="outline" className="rounded-full">
                      this case
                    </Badge>
                  )}
                  {v.reversedAt && (
                    <Badge variant="outline" className="rounded-full">
                      reversed
                    </Badge>
                  )}
                  {v.appeals[0] && (
                    <Badge
                      variant={APPEAL_STATUS_BADGE[v.appeals[0].status] ?? "outline"}
                      className="rounded-full"
                    >
                      appeal {pretty(v.appeals[0].status)}
                    </Badge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatAgo(v.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Evidence trail">
          {evidence.length === 0 ? (
            <p className="text-sm text-muted-foreground">No structured evidence recorded.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl bg-muted p-4">
              <pre className="text-xs leading-relaxed">
                {JSON.stringify(evidence, null, 2)}
              </pre>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
