import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, Hourglass, Scale, XCircle } from "lucide-react";
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
  const appealOpen = appeal?.status === "SUBMITTED" || appeal?.status === "PENDING_REVIEW";

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

      {violation.canAppeal ? (
        <>
          <section aria-label="Your right to appeal" className="mt-6 flex items-start gap-3 px-1">
            <Scale className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm leading-relaxed text-muted-foreground">{APPEAL_RIGHT_COPY}</p>
          </section>
          <AppealForm violationId={violation.id} />
        </>
      ) : appealOpen ? (
        <section aria-label="Appeal pending" className="glass mt-6 rounded-[28px] p-6">
          <div className="flex items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-foreground/5">
              <Hourglass className="size-6 text-gold" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-display text-xl font-semibold tracking-tight">
                Appeal pending review
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {APPEAL_PENDING_COPY}
              </p>
              {appeal && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Submitted {formatDate(appeal.submittedAt)}
                </p>
              )}
            </div>
          </div>
        </section>
      ) : appeal?.status === "APPROVED" ? (
        <section aria-label="Appeal approved" className="glass mt-6 rounded-[28px] p-6">
          <div className="flex items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-foreground/5">
              <CheckCircle2 className="size-6 text-success" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-display text-xl font-semibold tracking-tight">
                Appeal approved
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                After review, we reversed the action taken on your account. Everything affected has
                been restored{appeal.decidedAt ? ` on ${formatDate(appeal.decidedAt)}` : ""}.
                Thanks for your patience.
              </p>
            </div>
          </div>
        </section>
      ) : appeal?.status === "REJECTED" ? (
        <section aria-label="Appeal decision" className="glass mt-6 rounded-[28px] p-6">
          <div className="flex items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-foreground/5">
              <XCircle className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-display text-xl font-semibold tracking-tight">
                Appeal reviewed
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                A member of our team took a careful look
                {appeal.decidedAt ? ` on ${formatDate(appeal.decidedAt)}` : ""} and the action on
                your account stays in place. This decision is final.
              </p>
            </div>
          </div>
        </section>
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
