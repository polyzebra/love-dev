"use client";

import * as React from "react";
import { Progress as ProgressPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "border-border bg-foreground/10 relative h-2 w-full overflow-hidden rounded-full border",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="from-brand-bright to-brand-hover ease-luxe h-full w-full flex-1 rounded-full bg-linear-90 shadow-[0_0_12px_color-mix(in_srgb,var(--primary)_45%,transparent)] transition-transform duration-700"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
