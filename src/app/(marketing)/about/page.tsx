import type { Metadata } from "next";

export const metadata: Metadata = { title: "About Tirvea" };

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 pt-36 pb-16 md:px-8 md:pt-44">
      <h1 className="font-display text-4xl font-semibold tracking-tight">About Tirvea</h1>

      <div className="text-muted-foreground mt-6 space-y-4 leading-relaxed">
        <p>
          Tirvea is a dating platform built around intention and authenticity — real people, real
          photos, and the small details that help people connect.
        </p>
        <p>
          Tirvea is a brand and platform operated by <strong>WiseWave Limited</strong>, a company
          registered in Ireland (company number 762171), with its registered office at 39 Cooley
          Park, Dundalk, Co. Louth, A91 AP2V, Ireland.
        </p>
        <p>
          Trust and safety are central to how we build. We combine identity and optional photo
          verification, thoughtful moderation, and clear community rules to keep the experience
          genuine. You can read more in our{" "}
          <a className="text-foreground underline" href="/safety">
            Safety Centre
          </a>{" "}
          and our{" "}
          <a className="text-foreground underline" href="/legal/compliance">
            Compliance Statement
          </a>
          .
        </p>
        <p>
          Get in touch:{" "}
          <a className="text-foreground underline" href="mailto:info@tirvea.com">
            info@tirvea.com
          </a>
          .
        </p>
      </div>
    </main>
  );
}
