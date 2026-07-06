import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({
  className,
  href = "/",
  size = "md",
}: {
  className?: string;
  href?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = { sm: "text-lg", md: "text-xl", lg: "text-3xl" };
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 font-display font-semibold tracking-tight",
        sizes[size],
        className,
      )}
      aria-label="Amora — home"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={cn("text-primary", size === "lg" ? "size-8" : "size-6")}
        fill="currentColor"
      >
        <path d="M12 21.35c-.32 0-.64-.1-.9-.3C6.6 17.7 2 13.9 2 9.3 2 6.4 4.3 4 7.2 4c1.9 0 3.6 1 4.8 2.6C13.2 5 14.9 4 16.8 4 19.7 4 22 6.4 22 9.3c0 4.6-4.6 8.4-9.1 11.75-.26.2-.58.3-.9.3Z" />
      </svg>
      <span>Amora</span>
    </Link>
  );
}
