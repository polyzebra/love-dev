"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Admin segment error boundary. Renders inside the admin chrome (the
 * layout survives), so staff keep the nav and can retry just the page.
 * Honest register: no invented status - the digest is the only claim.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin-error]", error.digest, error);
  }, [error]);

  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-5 px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-3xl bg-accent">
        <TriangleAlert className="size-6 text-accent-foreground" aria-hidden="true" />
      </div>
      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold">This admin page failed to load</h1>
        <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
          The error has been logged. Retry the page; if it keeps failing, the rest of the admin
          area still works from the navigation.
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-muted-foreground">ref {error.digest}</p>
        )}
      </div>
      <Button className="rounded-full px-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
