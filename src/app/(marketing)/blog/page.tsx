import type { Metadata } from "next";
import { buildMarketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "Blog",
  description: "Stories on dating with intention, safety, and how we build Tirvea. Coming soon.",
  path: "/blog",
  index: false,
});

export default function BlogPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 pt-36 pb-16 md:px-8 md:pt-44">
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
    </main>
  );
}
