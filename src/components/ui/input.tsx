import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-2xl border border-input bg-foreground/5 px-3.5 py-1 text-base shadow-[inset_0_1px_0_var(--glass-highlight)] transition-[color,box-shadow,border-color] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/70 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        // Hover: slightly stronger neutral border - never a color shift.
        "hover:border-foreground/25",
        // Focus: the border stays NEUTRAL; a soft brand halo alone marks
        // focus. The theme's --ring is visually a red, so a full-opacity
        // focus-visible:border-ring reads as a validation error.
        "focus-visible:border-input focus-visible:ring-2 focus-visible:ring-ring/15 dark:focus-visible:ring-ring/25",
        // Error: destructive treatment ONLY for a real validation failure,
        // signalled by aria-invalid. Compound variants keep the red border
        // while the invalid field is focused or hovered.
        "aria-invalid:border-destructive aria-invalid:ring-destructive/25 aria-invalid:hover:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/25 dark:aria-invalid:ring-destructive/40 dark:aria-invalid:focus-visible:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
