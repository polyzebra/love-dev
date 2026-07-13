"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error]", error.digest, error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="bg-accent flex size-16 items-center justify-center rounded-3xl">
        <TriangleAlert className="text-accent-foreground size-7" aria-hidden="true" />
      </div>
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-muted-foreground max-w-sm">
          An unexpected error occurred. It has been logged and we&apos;re on it.
        </p>
        {error.digest && <p className="text-muted-foreground text-xs">Reference: {error.digest}</p>}
      </div>
      <Button size="lg" className="rounded-full px-8" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
