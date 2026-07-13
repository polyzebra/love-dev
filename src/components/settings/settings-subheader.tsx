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
        className="glass-chip text-foreground hover:bg-foreground/10 focus-visible:ring-foreground/20 mb-5 inline-flex size-11 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
      </Link>
      <PageHeader title={title} description={description} />
    </>
  );
}
