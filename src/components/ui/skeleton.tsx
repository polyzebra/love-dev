import { cn } from "@/lib/utils"

/** Loading placeholder - a glass surface with a slow light sweep. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/6 bg-white/5",
        "after:absolute after:inset-0 after:animate-sheen after:bg-gradient-to-r after:from-transparent after:via-white/6 after:to-transparent",
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
