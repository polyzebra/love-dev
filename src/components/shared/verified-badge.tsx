"use client";

import { useId } from "react";
import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * THE Tirvea Verified badge (L6.6 Trust Contract). ONE premium blue badge -
 * no tiers, no other colours, no emoji, no text beside it on cards. It is
 * rendered ONLY when the canonical resolver (publicBadgeVisible /
 * isPubliclyVerified) says so, which now means BOTH the identity is verified
 * AND the currently visible photos are the verified gallery. The label and
 * description are defined here ONCE (Phase J/M) so the trust copy can never
 * diverge across surfaces.
 */
export const VERIFIED_BADGE_LABEL = "Verified";
export const VERIFIED_BADGE_DESCRIPTION =
  "The identity of this member has been verified and the currently visible profile photos belong to that verified person.";

export function VerifiedBadge({
  className,
  iconClassName,
}: {
  className?: string;
  /** Per-surface contrast treatment (e.g. overlays keep a light stroke). */
  iconClassName?: string;
}) {
  const descId = useId();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn("inline-flex items-center text-sky-500", className)}
          role="img"
          aria-label={VERIFIED_BADGE_LABEL}
          aria-describedby={descId}
        >
          <BadgeCheck
            className={cn("text-background size-[1.1em] fill-sky-500", iconClassName)}
            aria-hidden="true"
          />
          {/* Screen-reader description (tooltip content is not reliably announced). */}
          <span id={descId} className="sr-only">
            {VERIFIED_BADGE_DESCRIPTION}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[16rem]">
        <p className="font-medium">{VERIFIED_BADGE_LABEL}</p>
        <p className="text-xs opacity-90">{VERIFIED_BADGE_DESCRIPTION}</p>
      </TooltipContent>
    </Tooltip>
  );
}
