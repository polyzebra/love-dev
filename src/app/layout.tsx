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
    default: "Virelsy - Dating, designed with intention",
    template: "%s · Virelsy",
  },
  description:
    "Virelsy is a premium dating platform. Verified profiles, thoughtful matching and conversations that go somewhere.",
  keywords: ["dating", "relationships", "verified dating", "premium dating"],
  openGraph: {
    title: "Virelsy - Dating, designed with intention",
    description:
      "A premium dating platform. Verified profiles, thoughtful matching and conversations that go somewhere.",
    type: "website",
    siteName: "Virelsy",
  },
  twitter: {
    card: "summary_large_image",
    title: "Virelsy - Dating, designed with intention",
    description: "A premium dating platform. Verified profiles, real intentions.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0B0709",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${inter.variable} ${playfair.variable} min-h-dvh font-sans`}>
        {children}
        <Toaster position="top-center" richColors theme="dark" />
      </body>
    </html>
  );
}
