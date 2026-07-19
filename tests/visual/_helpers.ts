import type { Page, Locator } from "@playwright/test";

/**
 * Make a page deterministic before snapshotting: kill animations/transitions,
 * hide carets, freeze scroll behaviour, and wait for web fonts to load. Called
 * in every visual test so the only pixels that move are real changes.
 */
export async function stabilize(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      caret-color: transparent !important;
      scroll-behavior: auto !important;
    }`,
  });
  await page.evaluate(async () => {
    await (document as Document & { fonts: FontFaceSet }).fonts.ready;
  });
  // Let a final layout/paint settle after fonts + injected CSS.
  await page.waitForTimeout(200);
}

/**
 * Regions that are legitimately non-deterministic and must be masked out of
 * comparisons: external images (Unsplash), the animated hero scene, and the
 * footer's current-year copyright line.
 */
export function dynamicMasks(page: Page): Locator[] {
  return [
    page.locator('img[src*="unsplash"], img[src^="https://images."]'),
    page.locator('[data-hero-scene], canvas'),
    page.locator("footer >> text=/©/"),
  ];
}
