import type { Metadata } from "next";
import { PageShell } from "@/components/layout/public";
import { buildMarketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "Blog",
  description: "Stories on dating with intention, safety, and how we build Tirvea. Coming soon.",
  path: "/blog",
  index: false,
});

export default function BlogPage() {
  return (
    <PageShell width="reading">
      <h1 className="font-display text-4xl font-semibold tracking-tight">Blog</h1>
      <div className="text-muted-foreground mt-6 space-y-4 leading-relaxed">
        <p>
          Stories on dating with intention, safety, and how we build Tirvea. We’re just getting
          started — new posts are on the way.
        </p>
        <p>
          Want to be notified?{" "}
          <a className="text-foreground underline" href="mailto:info@tirvea.com">
            info@tirvea.com
          </a>
          .
        </p>
      </div>
    </PageShell>
  );
}
