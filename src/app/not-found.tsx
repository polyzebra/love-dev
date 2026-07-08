import Link from "next/link";
import { HeartCrack } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/shared/logo";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo size="lg" />
      <div className="flex size-16 items-center justify-center rounded-3xl bg-accent">
        <HeartCrack className="size-7 text-accent-foreground" aria-hidden="true" />
      </div>
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Page not found</h1>
        <p className="max-w-sm text-muted-foreground">
          This page has moved on. Unlike your next match - they&apos;re still out there.
        </p>
      </div>
      <Button size="lg" className="rounded-full px-8" asChild>
        <Link href="/">Back to Tirvea</Link>
      </Button>
    </div>
  );
}
