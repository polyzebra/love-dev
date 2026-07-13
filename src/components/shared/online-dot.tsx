import { cn } from "@/lib/utils";

export function OnlineDot({ className, online = true }: { className?: string; online?: boolean }) {
  if (!online) return null;
  return (
    <span className={cn("relative flex size-2.5", className)} aria-label="Online now" role="status">
      <span className="animate-pulse-dot bg-success absolute inline-flex h-full w-full rounded-full opacity-75" />
      <span className="bg-success ring-card relative inline-flex size-2.5 rounded-full ring-2" />
    </span>
  );
}
