import type { MetadataRoute } from "next";

/**
 * PWA manifest - makes Tirvea installable (required for iOS Web Push:
 * Safari only exposes the Notification/Push APIs to Home Screen apps).
 * Colors mirror the dark theme tokens in globals.css (--background).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tirvea",
    short_name: "Tirvea",
    description:
      "A premium dating platform. Verified profiles, thoughtful matching and conversations that go somewhere.",
    id: "/discover",
    start_url: "/discover",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0709",
    theme_color: "#0b0709",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
