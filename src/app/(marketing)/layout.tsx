import { MarketingNavbar } from "@/components/marketing/navbar";
import { MarketingFooter } from "@/components/marketing/footer";
import { ScrollProgress } from "@/components/fx/scroll-progress";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background flex min-h-dvh flex-col">
      {/* First focusable on the page - lets keyboard/SR users jump past
          the floating navbar. Visible only while focused. */}
      <a
        href="#main-content"
        className="focus-visible:bg-surface-elevated focus-visible:text-foreground focus-visible:shadow-float focus-visible:ring-foreground/20 sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-4 focus-visible:left-4 focus-visible:z-[60] focus-visible:rounded-full focus-visible:px-5 focus-visible:py-3 focus-visible:text-sm focus-visible:font-medium focus-visible:ring-2"
      >
        Skip to content
      </a>
      <ScrollProgress />
      <MarketingNavbar />
      {/* Navbar floats - heroes own their top spacing */}
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
