import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The shared verified badge. `tier` selects the honest label:
 *   IDENTITY_VERIFIED -> "Identity verified"  (User.photoVerifiedAt)
 *   PHOTO_VERIFIED    -> "Photo verified"     (User.faceVerifiedAt)
 * Default is Identity - the truthful label for every user today (Photo
 * Verified is unreachable until the full trust workflow completes).
 */
const TIER_LABEL = {
  IDENTITY_VERIFIED: "Identity verified",
  PHOTO_VERIFIED: "Photo verified",
} as const;

export function VerifiedBadge({
  className,
  iconClassName,
  tier = "IDENTITY_VERIFIED",
}: {
  className?: string;
  /** Per-surface contrast treatment (e.g. overlays keep a dark stroke). */
  iconClassName?: string;
  tier?: keyof typeof TIER_LABEL;
}) {
  const label = TIER_LABEL[tier];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn("inline-flex items-center text-sky-500", className)}
          aria-label={label}
          role="img"
        >
          <BadgeCheck className={cn("text-background size-[1.1em] fill-sky-500", iconClassName)} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
