import { MarketingNavbar } from "@/components/marketing/navbar";
import { MarketingFooter } from "@/components/marketing/footer";
import { ScrollProgress } from "@/components/fx/scroll-progress";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <ScrollProgress />
      <MarketingNavbar />
      {/* Navbar floats — heroes own their top spacing */}
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}
