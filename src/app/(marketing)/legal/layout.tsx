export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <article className="prose-neutral mx-auto max-w-3xl px-5 pb-16 pt-36 md:px-8 md:pt-44 [&_h1]:font-display [&_h1]:text-4xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_p]:mt-4 [&_p]:leading-relaxed [&_p]:text-muted-foreground [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_li]:text-muted-foreground">
      {children}
    </article>
  );
}
