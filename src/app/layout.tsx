import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";
import { ThemeSync } from "@/components/theme/theme-sync";
import { MotionProvider } from "@/components/fx/motion-provider";
import type { Metadata, Viewport } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Tirvea - Dating, designed with intention",
    template: "%s · Tirvea",
  },
  description:
    "Tirvea is a premium dating platform. Verified profiles, thoughtful matching and conversations that go somewhere.",
  keywords: ["dating", "relationships", "verified dating", "premium dating"],
  // Home-screen icon for iOS - required alongside the manifest for a
  // proper "Add to Home Screen" install (and therefore iOS Web Push).
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Tirvea",
  },
  openGraph: {
    title: "Tirvea - Dating, designed with intention",
    description:
      "A premium dating platform. Verified profiles, thoughtful matching and conversations that go somewhere.",
    type: "website",
    siteName: "Tirvea",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tirvea - Dating, designed with intention",
    description: "A premium dating platform. Verified profiles, real intentions.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Keyboard resizes the LAYOUT viewport where supported (Chrome 108+,
  // Safari 26+): dvh-sized surfaces (chat thread) shrink with it, so the
  // composer stays pinned above the keyboard instead of being covered.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0B0709" },
    { media: "(prefers-color-scheme: light)", color: "#FAF6F4" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Pre-paint: correct theme class before first render - no flash */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className={`${inter.variable} ${playfair.variable} min-h-dvh font-sans`}>
        <ThemeSync />
        <MotionProvider>{children}</MotionProvider>
        <Toaster position="top-center" richColors theme="system" />
      </body>
    </html>
  );
}
