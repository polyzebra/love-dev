import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The one auth back button. A perfect 44x44 circle (Apple HIG minimum)
 * on every viewport: width === height via fixed size + aspect-square,
 * no padding/margin tricks that stretch the hover ellipse. Only
 * background-color, opacity and transform animate - never dimensions.
 */
export function BackButton({
  href,
  label = "Back",
  className,
  disabled = false,
}: {
  href: string;
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      className={cn(
        "inline-flex aspect-square size-11 shrink-0 items-center justify-center rounded-full",
        "text-muted-foreground outline-none",
        "transition-[background-color,opacity,transform] duration-150",
        "hover:bg-foreground/5 hover:text-foreground",
        "active:bg-foreground/10 active:scale-[0.98]",
        "focus-visible:ring-foreground/20 focus-visible:ring-2",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <ArrowLeft className="size-5" aria-hidden="true" />
    </Link>
  );
}
