import { cn } from "@/lib/utils";

/**
 * The one loading indicator for the app: a small, quiet spinner.
 * Used as the Suspense/loading.tsx fallback everywhere - no placeholder mockups.
 *
 * `fullStage` renders it on the swipe stage geometry (fixed, edge-to-edge,
 * clear of the desktop sidebar) so the deck mounts with zero layout shift.
 */
export function PageLoader({
  fullStage = false,
  className,
}: {
  fullStage?: boolean;
  className?: string;
}) {
  const spinner = (
    <span
      aria-hidden="true"
      className="border-foreground/20 border-t-primary size-6 animate-spin rounded-full border-2"
    />
  );

  if (fullStage) {
    return (
      <div
        role="status"
        aria-label="Loading"
        className={cn("bg-background fixed inset-0 z-30 overflow-hidden", className)}
      >
        <div className="absolute inset-0 flex items-center justify-center lg:left-72">
          {spinner}
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn("flex min-h-[50dvh] items-center justify-center", className)}
    >
      {spinner}
    </div>
  );
}
