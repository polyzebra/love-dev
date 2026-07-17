import type { Metadata } from "next";

export const metadata: Metadata = { title: "Press" };

export default function PressPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 pt-36 pb-16 md:px-8 md:pt-44">
      <h1 className="font-display text-4xl font-semibold tracking-tight">Press</h1>
      <div className="text-muted-foreground mt-6 space-y-4 leading-relaxed">
        <p>
          For press and media enquiries about Tirvea, please get in touch and we’ll respond as soon
          as we can.
        </p>
        <p>
          Media contact:{" "}
          <a className="text-foreground underline" href="mailto:info@tirvea.com">
            info@tirvea.com
          </a>
          .
        </p>
        <p>
          Tirvea is a platform operated by WiseWave Limited, registered in Ireland (No. 762171).
        </p>
      </div>
    </main>
  );
}
