import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex items-start justify-between gap-4 pb-6", className)}>
      <div className="space-y-1">
        <h1 className="font-display text-3xl font-medium tracking-tight md:text-4xl">{title}</h1>
        {description ? (
          <p className="text-muted-foreground text-sm md:text-base">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
