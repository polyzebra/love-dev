import { defineConfig } from "@playwright/test";

/**
 * L5.4 - Enterprise visual-regression config (the Design Quality Gate).
 *
 * Determinism is everything: one colour scheme, one timezone/locale, frozen
 * animations, reduced motion, fixed viewports, CSS-pixel scaling, hidden
 * carets. Fonts are self-hosted (next/font), so no network font race. Dynamic
 * regions (external images, the footer year) are masked in the specs.
 *
 * Baselines are PLATFORM-SPECIFIC (font anti-aliasing differs macOS vs Linux),
 * so the committed baselines are generated on the CI runner (Ubuntu). See
 * docs/VISUAL_REGRESSION_GUIDE.md. Run locally with `npm run test:visual`.
 */
const PORT = Number(process.env.VISUAL_PORT ?? 3230);

export default defineConfig({
  testDir: "./tests/visual",
  // Baselines live next to the specs, keyed by spec + snapshot name + project.
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : "50%",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "playwright-report/visual-results.json" }],
  ],
  timeout: 45_000,
  expect: {
    toHaveScreenshot: {
      // Font anti-aliasing tolerance; a real regression moves far more pixels.
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    colorScheme: "dark",
    timezoneId: "UTC",
    locale: "en-GB",
    deviceScaleFactor: 1,
    trace: "on-first-retry",
    // Local-dev escape hatch: point at an already-installed full chromium when
    // the default headless-shell isn't available. CI uses the managed browser
    // (`playwright install --with-deps chromium`) and never sets this.
    ...(process.env.PW_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
      : {}),
  },
  // The responsive ladder. Add/remove breakpoints here - specs are viewport
  // agnostic, so a new project instantly covers every page/component.
  projects: [
    { name: "mobile-390", use: { viewport: { width: 390, height: 844 } } },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1024 } } },
    { name: "desktop-1280", use: { viewport: { width: 1280, height: 900 } } },
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 900 } } },
    { name: "large-1600", use: { viewport: { width: 1600, height: 1000 } } },
  ],
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
