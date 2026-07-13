"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Magnetic } from "@/components/fx/magnetic";

/**
 * Hero call-to-action - one sizing, one shape, everywhere.
 * Primary gets the magnetic pull; secondary stays still.
 */
export function HeroCta({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
}) {
  const button = (
    <Button
      size="lg"
      variant={variant === "primary" ? "default" : "outline"}
      className={
        variant === "primary"
          ? "h-14 rounded-full px-10 text-base"
          : "h-14 rounded-full px-8 text-base"
      }
      asChild
    >
      <Link href={href}>{children}</Link>
    </Button>
  );

  return variant === "primary" ? <Magnetic>{button}</Magnetic> : button;
}
