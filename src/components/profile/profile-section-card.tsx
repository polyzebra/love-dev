import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * THE shared premium card for profile content sections (In my words,
 * prompts, and any future section). One place owns the treatment:
 * house glass material (background + shadow untouched), the profile
 * radius, and a whisper of accent on the border (accent-foreground at
 * 8% - inline so it deterministically wins over .glass's border
 * shorthand regardless of utility emission order). No gradients.
 */
export function ProfileSectionCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn("glass rounded-xl p-6", className)}
      style={{ borderColor: "color-mix(in srgb, var(--accent-foreground) 8%, transparent)" }}
    >
      {children}
    </section>
  );
}
