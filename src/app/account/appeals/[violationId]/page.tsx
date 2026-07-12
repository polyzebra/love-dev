import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Hourglass,
  RotateCcw,
  Scale,
  SearchCheck,
  XCircle,
} from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { RESTRICTED_ACCOUNT_ROUTE } from "@/lib/auth/gate";
import { getAccountStatusView } from "@/lib/services/appeals";
import {
  ACTION_LABEL,
  APPEAL_PENDING_COPY,
  APPEAL_RIGHT_COPY,
  VIOLATION_TYPE_LABEL,
  formatDate,
} from "../../copy";
import { AppealForm } from "./appeal-form";
import { AppealRespond, AppealWithdraw } from "./appeal-manage";
import { AppealTimeline } from "./appeal-timeline";

export const metadata: Metadata = { title: "Violation details" };
export const dynamic = "force-dynamic";

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm leading-relaxed">{children}</dd>
    </div>
  );
}

/** Calm state card - one icon, one headline, one paragraph. */
function StateCard({
  icon: Icon,
  iconClass,
  title,
  ariaLabel,
  children,
}: {
  icon: typeof Hourglass;
  iconClass: string;
  title: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={ariaLabel} className="glass mt-6 rounded-[28px] p-6">
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-foreground/5">
          <Icon className={`size-6 ${iconClass}`} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
          <div className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{children}</div>
        </div>
      </div>
    </section>
  );
}

export default async function ViolationDetailPage({
  params,
}: {
  params: Promise<{ violationId: string }>;
}) {
  const { violationId } = await params;
  const user = await requireUser({ allow: RESTRICTED_ACCOUNT_ROUTE });
  const view = await getAccountStatusView(user.id);
  if (!view) redirect("/login");

  const violation = view.violations.find((v) => v.id === violationId);
  if (!violation) notFound();

  const appeal = violation.appeal;
  const status = appeal?.status ?? null;
  const submittedState = status === "SUBMITTED" || status === "PENDING_REVIEW";
  // Latest staff question for the NEEDS_INFO card (it also stays on the
  // timeline for the record).
  const latestQuestion =
    appeal?.timeline
      .filter((e) => e.type === "needs_info_requested" && e.note)
      .at(-1)?.note ?? null;

  return (
    // NOT animate-rise: the utility's `both` fill keeps a transform on the
    // wrapper forever, which turns the appeal form's position:fixed CTA into
    // an absolutely-positioned child (fixed re-parents under any transformed
    // ancestor). The sticky bar must stay viewport-pinned.
    <div>
      <Link
        href="/account/status"
        className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Account status
      </Link>

      <h1 className="font-display text-3xl font-semibold tracking-tight text-balance md:text-4xl">
        {ACTION_LABEL[violation.actionTaken]}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {formatDate(violation.createdAt)}
        {violation.tab === "expired" ? " · No longer active" : ""}
      </p>

      <section aria-label="What happened" className="mt-6">
        <dl className="divide-y overflow-hidden rounded-3xl border border-border bg-card/80 shadow-card">
          <DetailRow label="Description">{violation.userVisibleReason}</DetailRow>
          <DetailRow label="Violation type">
            {VIOLATION_TYPE_LABEL[violation.violationType]}
          </DetailRow>
          <DetailRow label="Action taken">
            {ACTION_LABEL[violation.actionTaken]}
            {violation.expiresAt ? ` · until ${formatDate(violation.expiresAt)}` : ""}
          </DetailRow>
          <DetailRow label="What this means">{violation.consequence}</DetailRow>
        </dl>
      </section>

      {/* ----- Appeal state ------------------------------------------------ */}

      {violation.canAppeal ? (
        <>
          {status === "WITHDRAWN" && (
            <StateCard
              icon={RotateCcw}
              iconClass="text-muted-foreground"
              title="Previous appeal withdrawn"
              ariaLabel="Previous appeal withdrawn"
            >
              You withdrew your last appeal
              {appeal ? ` on ${formatDate(appeal.timeline.at(-1)?.at ?? appeal.submittedAt)}` : ""}
              . That&apos;s not held against you - you can appeal this decision again below.
            </StateCard>
          )}
          {status === "EXPIRED" && (
            <StateCard
              icon={XCircle}
              iconClass="text-muted-foreground"
              title="Previous appeal closed"
              ariaLabel="Previous appeal closed"
            >
              Your last appeal closed because we didn&apos;t receive a reply to our question in
              time. No decision was made, so you can appeal this decision again below.
            </StateCard>
          )}
          {appeal && <AppealTimeline timeline={appeal.timeline} />}
          <section aria-label="Your right to appeal" className="mt-6 flex items-start gap-3 px-1">
            <Scale className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm leading-relaxed text-muted-foreground">{APPEAL_RIGHT_COPY}</p>
          </section>
          <AppealForm violationId={violation.id} />
        </>
      ) : appeal && submittedState ? (
        <>
          <StateCard
            icon={Hourglass}
            iconClass="text-gold"
            title="Appeal pending review"
            ariaLabel="Appeal pending"
          >
            <p>{APPEAL_PENDING_COPY}</p>
            <p className="mt-2 text-xs">Submitted {formatDate(appeal.submittedAt)}</p>
          </StateCard>
          <AppealTimeline timeline={appeal.timeline} />
          {appeal.canWithdraw && <AppealWithdraw appealId={appeal.id} />}
        </>
      ) : appeal && status === "UNDER_REVIEW" ? (
        <>
          <StateCard
            icon={SearchCheck}
            iconClass="text-gold"
            title="Your appeal is being reviewed"
            ariaLabel="Appeal under review"
          >
            A member of our Trust &amp; Safety team is looking at your appeal right now. There is
            nothing you need to do - we&apos;ll email you once a decision has been made.
          </StateCard>
          <AppealTimeline timeline={appeal.timeline} />
          {appeal.canWithdraw && <AppealWithdraw appealId={appeal.id} />}
        </>
      ) : appeal && status === "NEEDS_INFO" ? (
        <>
          <AppealRespond
            appealId={appeal.id}
            question={latestQuestion}
            respondByLabel={appeal.respondBy ? formatDate(appeal.respondBy) : null}
          />
          <AppealTimeline timeline={appeal.timeline} />
          {appeal.canWithdraw && <AppealWithdraw appealId={appeal.id} />}
        </>
      ) : appeal && status === "APPROVED" ? (
        <>
          <StateCard
            icon={CheckCircle2}
            iconClass="text-success"
            title="Appeal approved"
            ariaLabel="Appeal approved"
          >
            After review, we reversed the action taken on your account. Everything affected has
            been restored{appeal.decidedAt ? ` on ${formatDate(appeal.decidedAt)}` : ""}. Thanks
            for your patience.
          </StateCard>
          <AppealTimeline timeline={appeal.timeline} />
        </>
      ) : appeal && status === "REJECTED" ? (
        <>
          <StateCard
            icon={XCircle}
            iconClass="text-muted-foreground"
            title="Appeal reviewed"
            ariaLabel="Appeal decision"
          >
            A member of our team took a careful look
            {appeal.decidedAt ? ` on ${formatDate(appeal.decidedAt)}` : ""} and the action on your
            account stays in place. This decision is final.
          </StateCard>
          <AppealTimeline timeline={appeal.timeline} />
        </>
      ) : violation.tab === "expired" ? (
        <p className="mt-6 px-1 text-sm leading-relaxed text-muted-foreground">
          This action is no longer active on your account. It stays listed here for your records.
        </p>
      ) : (
        <p className="mt-6 px-1 text-sm leading-relaxed text-muted-foreground">
          This decision is not appealable. If you have questions, our{" "}
          <Link
            href="/account/community-resources"
            className="underline underline-offset-2 hover:text-foreground"
          >
            community resources
          </Link>{" "}
          explain how decisions are made.
        </p>
      )}
    </div>
  );
}
