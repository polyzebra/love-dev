import Link from "next/link";
import { cn } from "@/lib/utils";

/** Intrinsic dimensions per size, derived from the wordmark's 1084:259
 *  viewBox so the browser reserves the exact box - no layout shift. */
const SIZES = {
  sm: { width: 67, height: 16, className: "h-4" },
  md: { width: 84, height: 20, className: "h-5" },
  lg: { width: 134, height: 32, className: "h-8" },
} as const;

export function Logo({
  className,
  href = "/",
  size = "md",
}: {
  className?: string;
  href?: string;
  size?: "sm" | "md" | "lg";
}) {
  const s = SIZES[size];
  return (
    <Link
      href={href}
      className={cn("inline-flex items-center", className)}
      aria-label="Tirvea - home"
    >
      {/* Static SVG wordmark: plain <img> on purpose - next/image would
          route it through the optimizer, which rejects SVG by default. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-web.svg"
        alt=""
        width={s.width}
        height={s.height}
        className={cn("w-auto select-none", s.className)}
        draggable={false}
      />
    </Link>
  );
}
