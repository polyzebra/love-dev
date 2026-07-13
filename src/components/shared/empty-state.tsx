import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[50dvh] flex-col items-center justify-center gap-4 px-8 py-16 text-center",
        className,
      )}
    >
      <div className="bg-accent flex size-16 items-center justify-center rounded-3xl">
        <Icon className="text-accent-foreground size-7" aria-hidden="true" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-muted-foreground mx-auto max-w-sm text-sm leading-relaxed">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}
