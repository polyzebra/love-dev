import { cn } from "@/lib/utils"

/**
 * Loading placeholder. House rules:
 * - Skeletons must mirror the FINAL layout's shapes and sizes - never a
 *   generic grey page. If the final card is rounded-xl, so is its skeleton.
 * - Swap to content with an opacity-only crossfade (subtleEase at
 *   DURATIONS.fast - see src/lib/motion.ts). Never slide or scale.
 * - Quiet flows keep the existing PageLoader spinner; skeletons are for
 *   content-shaped surfaces (cards, lists, profiles).
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-2xl bg-foreground/10", className)}
      {...props}
    />
  )
}

export { Skeleton }
