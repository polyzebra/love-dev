import type { Metadata } from "next";
import { LegalChrome } from "@/components/legal/legal-chrome";

/**
 * L2.9 - the whole legal surface is noindex by default while it is in draft /
 * pending counsel approval. Master-backed pages whose frontmatter is published
 * and no longer requires counsel review override this to `index` via their own
 * generateMetadata (see src/lib/legal/seo.ts). This guarantees that no legacy
 * JSX page or placeholder is ever indexed merely because it lacks a master.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <LegalChrome>{children}</LegalChrome>;
}
