export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <article className="prose-neutral [&_h1]:font-display [&_p]:text-muted-foreground [&_li]:text-muted-foreground mx-auto max-w-3xl px-5 pt-36 pb-16 md:px-8 md:pt-44 [&_h1]:text-4xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_p]:mt-4 [&_p]:leading-relaxed [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
      {children}
    </article>
  );
}
