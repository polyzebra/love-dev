import { cn } from "@/lib/utils";

export function OnlineDot({ className, online = true }: { className?: string; online?: boolean }) {
  if (!online) return null;
  return (
    <span className={cn("relative flex size-2.5", className)} aria-label="Online now" role="status">
      <span className="absolute inline-flex h-full w-full animate-pulse-dot rounded-full bg-success opacity-75" />
      <span className="relative inline-flex size-2.5 rounded-full bg-success ring-2 ring-card" />
    </span>
  );
}
