import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";

/**
 * Header for settings subpages: a round back button to the parent
 * route, then the standard PageHeader so subpages sit in the same
 * rhythm as the rest of the settings shell.
 */
export function SettingsSubheader({
  backHref,
  backLabel,
  title,
  description,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  description?: string;
}) {
  return (
    <>
      <Link
        href={backHref}
        aria-label={backLabel}
        className="glass-chip mb-5 inline-flex size-11 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
      </Link>
      <PageHeader title={title} description={description} />
    </>
  );
}
