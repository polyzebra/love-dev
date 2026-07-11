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
import {
  ACTION_LABEL,
  APPEAL_STATUS_LABEL,
  VIOLATION_TYPE_LABEL,
  formatDate,
} from "../copy";

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
      : violation.appeal
        ? APPEAL_STATUS_LABEL[violation.appeal.status]
        : violation.canAppeal
          ? "You can appeal"
          : null;
  return (
    <Link
      href={`/account/appeals/${violation.id}`}
      className={`flex min-h-11 items-center gap-4 px-5 py-4 transition-colors hover:bg-muted ${
        first ? "" : "border-t"
      }`}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent">
        <Icon className="size-5 text-accent-foreground" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{ACTION_LABEL[violation.actionTaken]}</span>
        <span className="block truncate text-sm text-muted-foreground">
          {VIOLATION_TYPE_LABEL[violation.violationType]} · {formatDate(violation.createdAt)}
        </span>
        {chip && (
          <span className="mt-1 inline-flex rounded-full bg-foreground/5 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {chip}
          </span>
        )}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

function ViolationList({ violations, emptyCopy }: { violations: ViolationView[]; emptyCopy: string }) {
  if (violations.length === 0) {
    return (
      <p className="rounded-3xl border border-dashed px-5 py-8 text-center text-sm text-muted-foreground">
        {emptyCopy}
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card/80 shadow-card">
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

      <section aria-label="Current standing" className="glass mt-6 rounded-[28px] p-6">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-foreground/5">
            <StatusIcon className={`size-6 ${statusIconClass}`} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold tracking-tight text-balance">
              {view.statusCard.headline}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
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
        <Tabs defaultValue={byTab.active.length > 0 ? "active" : hasAppeals ? "appealed" : "expired"} className="mt-8">
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
          <div className="overflow-hidden rounded-3xl border border-border bg-card/80 shadow-card">
            <Link
              href="/account/appeals"
              className="flex min-h-11 items-center gap-4 px-5 py-4 transition-colors hover:bg-muted"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent">
                <FileText className="size-5 text-accent-foreground" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Your appeals</span>
                <span className="block truncate text-sm text-muted-foreground">
                  Every appeal you&apos;ve submitted, with its status
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </div>
        </section>
      )}

      <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
        Decisions are reviewed by people, not made automatically. Read more in our{" "}
        <Link
          href="/account/community-resources"
          className="underline underline-offset-2 hover:text-foreground"
        >
          community resources
        </Link>
        .
      </p>
    </div>
  );
}
