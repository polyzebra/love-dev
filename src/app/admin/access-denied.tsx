import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Calm 403 surface for the admin area. Rendered by the admin layout (and
 * super-only pages) IN PLACE of the admin chrome when an authenticated
 * account lacks the required role - per spec we do not bounce signed-in
 * users away, we tell them plainly. No data, no nav, no role details
 * beyond what the visitor already knows about themselves.
 */
export function AccessDenied({
  title = "Access denied",
  message = "This area is for Tirvea staff. Your account does not have admin access.",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card/80 p-8 text-center shadow-card">
        <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent">
          <ShieldAlert className="size-6 text-accent-foreground" aria-hidden="true" />
        </span>
        <h1 className="font-display text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <Button asChild variant="secondary" className="mt-6 w-full rounded-full">
          <Link href="/discover">Back to Tirvea</Link>
        </Button>
      </div>
    </main>
  );
}
