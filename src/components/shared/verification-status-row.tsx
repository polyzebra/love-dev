import Link from "next/link";
import { BadgeCheck, CircleAlert, CircleDashed, Hourglass, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * THE shared verification status row (Phase 3 of the verification
 * go-live). One visual vocabulary for Email/Phone/Photo/ID rows across
 * the profile trust strip and the account settings list - surfaces may
 * differ in copy and density (`variant`), never in state semantics.
 */

export type VerificationRowState = "verified" | "todo" | "pending" | "needs-action" | "unavailable";

export const VERIFICATION_STATE_ICON: Record<
  VerificationRowState,
  { icon: LucideIcon; className: string }
> = {
  verified: { icon: BadgeCheck, className: "text-success" },
  pending: { icon: Hourglass, className: "text-gold" },
  "needs-action": { icon: CircleAlert, className: "text-muted-foreground" },
  todo: { icon: CircleDashed, className: "text-muted-foreground/40" },
  unavailable: { icon: CircleDashed, className: "text-muted-foreground/50" },
};

export function VerificationStatusRow({
  label,
  state,
  value,
  action,
  variant = "chip",
}: {
  label: string;
  state: VerificationRowState;
  /** Secondary line (settings list); omitted in the compact chip variant. */
  value?: string;
  /** Real destination only - no dead buttons (null = no action). */
  action: { label: string; href: string } | null;
  /** chip = profile trust strip; list = settings rows. */
  variant?: "chip" | "list";
}) {
  const { icon: Icon, className } = VERIFICATION_STATE_ICON[state];

  if (variant === "list") {
    return (
      <div className="flex items-center gap-3 py-3.5 first:pt-0 last:pb-0">
        <Icon className={`size-5 shrink-0 ${className}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{label}</p>
          {value && (
            <p className="text-muted-foreground truncate text-sm" title={value}>
              {value}
            </p>
          )}
        </div>
        {action && (
          <Button variant="outline" className="h-11 shrink-0 rounded-full px-4" asChild>
            <Link href={action.href}>{action.label}</Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="glass flex items-center gap-2.5 rounded-3xl px-4 py-3.5 text-sm">
      <Icon className={`size-5 shrink-0 ${className}`} aria-hidden="true" />
      <span className={state === "verified" ? "" : "text-muted-foreground"}>{label}</span>
      {action && (
        <Button variant="link" size="sm" className="ml-auto h-auto p-0" asChild>
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
    </div>
  );
}
