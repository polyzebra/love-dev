import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";
import { ThemeSync } from "@/components/theme/theme-sync";
import { MotionProvider } from "@/components/fx/motion-provider";
import { siteUrl } from "@/lib/auth/url";
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
  // SEO-1 (L7.2): the ONE canonical site URL (siteUrl - NEXT_PUBLIC_SITE_URL,
  // production localhost-guarded) backs metadataBase, so every root-relative
  // canonical / Open Graph / Twitter URL resolves against the real origin.
  // NEXT_PUBLIC_APP_URL is NO LONGER a metadata source.
  metadataBase: new URL(siteUrl()),
  title: {
    default: "Tirvea - Dating, designed with intention",
    template: "%s · Tirvea",
  },
  description:
    "Tirvea is a premium dating platform. Verified profiles, thoughtful matching and conversations that go somewhere.",
  keywords: ["dating", "relationships", "verified dating", "premium dating"],
  // Installable PWA manifest - required for iOS Web Push (Safari only
  // exposes the Notification/Push APIs to Home Screen apps).
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icons/favicon-64.png", sizes: "64x64", type: "image/png" },
      { url: "/icons/favicon-96.png", sizes: "96x96", type: "image/png" },
      { url: "/logo.svg", type: "image/svg+xml", sizes: "any" },
    ],
    shortcut: "/favicon.ico",
    // Home-screen icon for iOS - required alongside the manifest for a
    // proper "Add to Home Screen" install.
    apple: "/apple-touch-icon.png",
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
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Tirvea" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Tirvea - Dating, designed with intention",
    description: "A premium dating platform. Verified profiles, real intentions.",
    images: ["/og.png"],
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
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
        {/* TEMPORARY: auth-transition diagnostics, active only with ?authdebug=1 */}
      </body>
    </html>
  );
}
