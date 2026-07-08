import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-2xl border border-input bg-foreground/5 px-3.5 py-2 text-base shadow-[inset_0_1px_0_var(--glass-highlight)] transition-[color,box-shadow,border-color] outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        // Hover: slightly stronger neutral border - never a color shift.
        "hover:border-foreground/25",
        // Focus: neutral border + soft brand halo only (--ring is visually
        // a red - a full-opacity rose border reads as a validation error).
        "focus-visible:border-input focus-visible:ring-2 focus-visible:ring-ring/15 dark:focus-visible:ring-ring/25",
        // Error: destructive ONLY via aria-invalid (a real failure), kept
        // through hover/focus by the compound variants.
        "aria-invalid:border-destructive aria-invalid:ring-destructive/25 aria-invalid:hover:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/25 dark:aria-invalid:ring-destructive/40 dark:aria-invalid:focus-visible:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
