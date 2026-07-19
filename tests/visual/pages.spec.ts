import { test, expect } from "@playwright/test";
import { stabilize, dynamicMasks } from "./_helpers";

/**
 * L5.4 - full-page visual baselines for every important public page, captured
 * on every configured viewport (see playwright.config.ts projects). A layout,
 * spacing, typography, alignment, or overflow regression on any of these fails
 * the Design Quality Gate.
 */
const PAGES: { name: string; path: string }[] = [
  { name: "home", path: "/" },
  { name: "about", path: "/about" },
  { name: "pricing", path: "/pricing" },
  { name: "safety", path: "/safety" },
  { name: "help", path: "/help" },
  { name: "legal-hub", path: "/legal" },
  { name: "legal-privacy", path: "/legal/privacy" },
  { name: "legal-terms", path: "/legal/terms" },
  { name: "legal-cookies", path: "/legal/cookies" },
  { name: "legal-community", path: "/legal/community-guidelines" },
  { name: "legal-trust-safety", path: "/legal/trust-safety" },
  { name: "legal-acceptable-use", path: "/legal/acceptable-use" },
  { name: "legal-identity-verification", path: "/legal/identity-verification" },
  { name: "legal-photo-verification", path: "/legal/photo-verification" },
  { name: "legal-security", path: "/legal/security" },
  { name: "legal-compliance", path: "/legal/compliance" },
  { name: "legal-contact", path: "/legal/contact" },
  { name: "contact", path: "/contact" },
  { name: "careers", path: "/careers" },
  { name: "press", path: "/press" },
  { name: "not-found", path: "/__no-such-route__" },
];

for (const p of PAGES) {
  test(`page: ${p.name}`, async ({ page }) => {
    await page.goto(p.path, { waitUntil: "networkidle" });
    await stabilize(page);
    await expect(page).toHaveScreenshot(`${p.name}.png`, {
      fullPage: true,
      mask: dynamicMasks(page),
    });
  });
}
