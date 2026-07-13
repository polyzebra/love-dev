import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ChevronRight,
  Clock,
  FileText,
  ImageOff,
  Info,
  Moon,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  type LucideIcon,
} from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { RESTRICTED_ACCOUNT_ROUTE } from "@/lib/auth/gate";
import { getAccountStatusView, type ViolationView } from "@/lib/services/appeals";
import { EmptyState } from "@/components/shared/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ACTION_LABEL, APPEAL_STATUS_LABEL, VIOLATION_TYPE_LABEL, formatDate } from "../copy";

export const metadata: Metadata = { title: "Account status" };
export const dynamic = "force-dynamic";

/** Tone of the status card - calm always; colour only as a quiet accent. */
const STATUS_ICON: Record<string, { icon: LucideIcon; className: string }> = {
  ACTIVE: { icon: ShieldCheck, className: "text-success" },
  LIMITED: { icon: Clock, className: "text-gold" },
  PHOTO_REVIEW_REQUIRED: { icon: ShieldAlert, className: "text-gold" },
  SUSPENDED: { icon: ShieldAlert, className: "text-destructive" },
  BANNED: { icon: ShieldOff, className: "text-destructive" },
  SHADOW_BANNED: { icon: Shield, className: "text-muted-foreground" },
  DEACTIVATED: { icon: Moon, className: "text-muted-foreground" },
};

const ACTION_ICON: Record<ViolationView["actionTaken"], LucideIcon> = {
  WARNING: Info,
  PHOTO_REMOVED: ImageOff,
  UPLOAD_BLOCKED: ImageOff,
  LIMITED: Clock,
  SUSPENDED: ShieldAlert,
  BANNED: ShieldOff,
};

function ViolationRow({ violation, first }: { violation: ViolationView; first: boolean }) {
  const Icon = ACTION_ICON[violation.actionTaken];
  const chip =
    violation.tab === "expired"
      ? "No longer active"
      : violation.canAppeal
        ? violation.appeal
          ? "You can appeal again"
          : "You can appeal"
        : violation.appeal
          ? APPEAL_STATUS_LABEL[violation.appeal.status]
          : null;
  // The one state that asks something OF the user gets a quiet highlight.
  const needsReply = violation.appeal?.status === "NEEDS_INFO";
  return (
    <Link
      href={`/account/appeals/${violation.id}`}
      className={`hover:bg-muted flex min-h-11 items-center gap-4 px-5 py-4 transition-colors ${
        first ? "" : "border-t"
      }`}
    >
      <span className="bg-accent flex size-10 shrink-0 items-center justify-center rounded-2xl">
        <Icon className="text-accent-foreground size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{ACTION_LABEL[violation.actionTaken]}</span>
        <span className="text-muted-foreground block truncate text-sm">
          {VIOLATION_TYPE_LABEL[violation.violationType]} · {formatDate(violation.createdAt)}
        </span>
        {chip && (
          <span
            className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
              needsReply ? "bg-gold/15 text-gold" : "bg-foreground/5 text-muted-foreground"
            }`}
          >
            {chip}
          </span>
        )}
      </span>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
    </Link>
  );
}

function ViolationList({
  violations,
  emptyCopy,
}: {
  violations: ViolationView[];
  emptyCopy: string;
}) {
  if (violations.length === 0) {
    return (
      <p className="text-muted-foreground rounded-3xl border border-dashed px-5 py-8 text-center text-sm">
        {emptyCopy}
      </p>
    );
  }
  return (
    <div className="border-border bg-card/80 shadow-card overflow-hidden rounded-3xl border">
      {violations.map((v, i) => (
        <ViolationRow key={v.id} violation={v} first={i === 0} />
      ))}
    </div>
  );
}

export default async function AccountStatusPage() {
  const user = await requireUser({ allow: RESTRICTED_ACCOUNT_ROUTE });
  const view = await getAccountStatusView(user.id);
  if (!view) redirect("/login");

  const { icon: StatusIcon, className: statusIconClass } =
    STATUS_ICON[view.status] ?? STATUS_ICON.ACTIVE;
  const byTab = {
    active: view.violations.filter((v) => v.tab === "active"),
    expired: view.violations.filter((v) => v.tab === "expired"),
    appealed: view.violations.filter((v) => v.tab === "appealed"),
  };
  const hasAppeals = view.violations.some((v) => v.appeal !== null);

  return (
    <div className="animate-rise">
      <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">
        Account status
      </h1>

      <section aria-label="Current standing" className="glass mt-6 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <span className="bg-foreground/5 flex size-12 shrink-0 items-center justify-center rounded-2xl">
            <StatusIcon className={`size-6 ${statusIconClass}`} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold tracking-tight text-balance">
              {view.statusCard.headline}
            </h2>
            <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
              {view.statusCard.body}
            </p>
          </div>
        </div>
      </section>

      {view.violations.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No violations"
          description="You're in good standing. Thanks for keeping Tirvea a kind, safe place to meet people."
          className="min-h-[30dvh]"
        />
      ) : (
        <Tabs
          defaultValue={byTab.active.length > 0 ? "active" : hasAppeals ? "appealed" : "expired"}
          className="mt-8"
        >
          <TabsList className="h-11 w-full rounded-full p-1">
            <TabsTrigger value="active" className="min-h-9 rounded-full">
              Active{byTab.active.length > 0 ? ` (${byTab.active.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="expired" className="min-h-9 rounded-full">
              Expired{byTab.expired.length > 0 ? ` (${byTab.expired.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="appealed" className="min-h-9 rounded-full">
              Appealed{byTab.appealed.length > 0 ? ` (${byTab.appealed.length})` : ""}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="active" className="mt-3">
            <ViolationList
              violations={byTab.active}
              emptyCopy="No active restrictions on your account."
            />
          </TabsContent>
          <TabsContent value="expired" className="mt-3">
            <ViolationList
              violations={byTab.expired}
              emptyCopy="Nothing here. Restrictions that have ended or been reversed will appear here."
            />
          </TabsContent>
          <TabsContent value="appealed" className="mt-3">
            <ViolationList
              violations={byTab.appealed}
              emptyCopy="You haven't appealed any decisions."
            />
          </TabsContent>
        </Tabs>
      )}

      {hasAppeals && (
        <section aria-label="Appeals" className="mt-6">
          <div className="border-border bg-card/80 shadow-card overflow-hidden rounded-3xl border">
            <Link
              href="/account/appeals"
              className="hover:bg-muted flex min-h-11 items-center gap-4 px-5 py-4 transition-colors"
            >
              <span className="bg-accent flex size-10 shrink-0 items-center justify-center rounded-2xl">
                <FileText className="text-accent-foreground size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Your appeals</span>
                <span className="text-muted-foreground block truncate text-sm">
                  Every appeal you&apos;ve submitted, with its status
                </span>
              </span>
              <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            </Link>
          </div>
        </section>
      )}

      <p className="text-muted-foreground mt-8 text-center text-xs leading-relaxed">
        Decisions are reviewed by people, not made automatically. Read more in our{" "}
        <Link
          href="/account/community-resources"
          className="hover:text-foreground underline underline-offset-2"
        >
          community resources
        </Link>
        .
      </p>
    </div>
  );
}
