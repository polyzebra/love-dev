import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function VerifiedBadge({
  className,
  iconClassName,
  label = "Photo verified",
}: {
  className?: string;
  /** Per-surface contrast treatment (e.g. overlays keep a dark stroke). */
  iconClassName?: string;
  label?: string;
}) {
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
