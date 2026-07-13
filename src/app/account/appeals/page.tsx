import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  FileText,
  Hourglass,
  MessageCircleQuestion,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { RESTRICTED_ACCOUNT_ROUTE } from "@/lib/auth/gate";
import { getAccountStatusView } from "@/lib/services/appeals";
import type { AppealStatus } from "@/generated/prisma/enums";
import { EmptyState } from "@/components/shared/empty-state";
import { ACTION_LABEL, APPEAL_STATUS_LABEL, VIOLATION_TYPE_LABEL, formatDate } from "../copy";

export const metadata: Metadata = { title: "Your appeals" };
export const dynamic = "force-dynamic";

const APPEAL_ICON: Record<AppealStatus, { icon: LucideIcon; className: string }> = {
  SUBMITTED: { icon: Hourglass, className: "text-gold" },
  PENDING_REVIEW: { icon: Hourglass, className: "text-gold" },
  UNDER_REVIEW: { icon: Hourglass, className: "text-gold" },
  NEEDS_INFO: { icon: MessageCircleQuestion, className: "text-gold" },
  APPROVED: { icon: CheckCircle2, className: "text-success" },
  REJECTED: { icon: XCircle, className: "text-muted-foreground" },
  EXPIRED: { icon: XCircle, className: "text-muted-foreground" },
  WITHDRAWN: { icon: XCircle, className: "text-muted-foreground" },
};

export default async function AccountAppealsPage() {
  const user = await requireUser({ allow: RESTRICTED_ACCOUNT_ROUTE });
  const view = await getAccountStatusView(user.id);
  if (!view) redirect("/login");

  const appealed = view.violations.filter((v) => v.appeal !== null);

  return (
    <div className="animate-rise">
      <Link
        href="/account/status"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Account status
      </Link>
      <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">
        Your appeals
      </h1>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        Every appeal is reviewed by a member of our Trust &amp; Safety team. We&apos;ll email you
        when a decision has been made.
      </p>

      {appealed.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No appeals yet"
          description="If a decision on your account can be appealed, you'll find the option on its detail page."
          className="min-h-[35dvh]"
        />
      ) : (
        <div className="border-border bg-card/80 shadow-card mt-6 overflow-hidden rounded-3xl border">
          {appealed.map((v, i) => {
            const appeal = v.appeal!;
            const { icon: Icon, className } = APPEAL_ICON[appeal.status];
            return (
              <Link
                key={appeal.id}
                href={`/account/appeals/${v.id}`}
                className={`hover:bg-muted flex min-h-11 items-center gap-4 px-5 py-4 transition-colors ${
                  i > 0 ? "border-t" : ""
                }`}
              >
                <span className="bg-foreground/5 flex size-10 shrink-0 items-center justify-center rounded-2xl">
                  <Icon className={`size-5 ${className}`} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{APPEAL_STATUS_LABEL[appeal.status]}</span>
                  <span className="text-muted-foreground block truncate text-sm">
                    {ACTION_LABEL[v.actionTaken]} · {VIOLATION_TYPE_LABEL[v.violationType]}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-xs">
                    Submitted {formatDate(appeal.submittedAt)}
                    {appeal.decidedAt ? ` · Decided ${formatDate(appeal.decidedAt)}` : ""}
                  </span>
                </span>
                <ChevronRight
                  className="text-muted-foreground size-4 shrink-0"
                  aria-hidden="true"
                />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
