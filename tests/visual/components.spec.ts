import { test, expect } from "@playwright/test";
import { stabilize, dynamicMasks } from "./_helpers";

/**
 * L5.4 - isolated visual baselines for every reusable PUBLIC-surface component,
 * captured in-context (real routes, real styles) across every viewport, plus
 * interaction states (hover / focus / error). App-internal components (chat,
 * profile, match, verification dialogs) are protected by the same framework via
 * an authenticated gallery route - see docs/COMPONENT_VISUAL_TESTING.md.
 */

const isDesktop = (name: string) => name.startsWith("desktop") || name.startsWith("large");

test.describe("navigation & footer", () => {
  test("navbar", async ({ page }) => {
    await page.goto("/about");
    await stabilize(page);
    await expect(page.locator("header").first()).toHaveScreenshot("navbar.png");
  });

  test("footer", async ({ page }) => {
    await page.goto("/about");
    await stabilize(page);
    await expect(page.locator("footer")).toHaveScreenshot("footer.png", {
      mask: [page.locator("footer >> text=/©/")],
    });
  });

  test("mobile drawer (open)", async ({ page }, testInfo) => {
    // The trigger lives in `md:hidden` (navbar.tsx), so it exists only below
    // Tailwind's md breakpoint (768px). That excludes tablet-768 too - there
    // the button is hidden and .click() would wait out the full timeout.
    test.skip(
      !testInfo.project.name.startsWith("mobile"),
      "Mobile drawer is only rendered on mobile viewports.",
    );
    await page.goto("/about");
    await stabilize(page);
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.waitForTimeout(250);
    await expect(page).toHaveScreenshot("mobile-drawer.png");
  });
});

test.describe("hero & CTAs", () => {
  test("marketing hero", async ({ page }) => {
    await page.goto("/");
    await stabilize(page);
    // Viewport-level (top of page = the hero) so it works on every breakpoint.
    await expect(page).toHaveScreenshot("hero.png", { mask: dynamicMasks(page) });
  });

  test("cta group", async ({ page }) => {
    await page.goto("/about");
    await stabilize(page);
    await expect(page.getByRole("link", { name: "Create your account" }).first()).toBeVisible();
    // The hero CTA row.
    await expect(page.locator("main div").filter({ hasText: "Create your account" }).first()).toBeVisible();
  });
});

test.describe("button states", () => {
  test("primary button: default / hover / focus", async ({ page }) => {
    await page.goto("/about");
    await stabilize(page);
    const btn = page.getByRole("link", { name: "Create your account" }).first();
    await expect(btn).toHaveScreenshot("button-primary-default.png");
    await btn.hover();
    await expect(btn).toHaveScreenshot("button-primary-hover.png");
    await btn.focus();
    await expect(btn).toHaveScreenshot("button-primary-focus.png");
  });

  test("secondary (outline) button", async ({ page }) => {
    await page.goto("/about");
    await stabilize(page);
    await expect(
      page.getByRole("link", { name: "Explore the Safety Centre" }),
    ).toHaveScreenshot("button-outline.png");
  });
});

test.describe("forms & inputs", () => {
  test("contact form: default", async ({ page }) => {
    await page.goto("/contact");
    await stabilize(page);
    await expect(page.locator("form")).toHaveScreenshot("contact-form-default.png");
  });

  test("contact form: validation errors", async ({ page }) => {
    await page.goto("/contact");
    await stabilize(page);
    await page.getByRole("button", { name: "Send message" }).click();
    await page.waitForTimeout(200);
    await expect(page.locator("form")).toHaveScreenshot("contact-form-errors.png");
  });
});

test.describe("cards & grids", () => {
  test("help category grid", async ({ page }) => {
    await page.goto("/help");
    await stabilize(page);
    await expect(page.locator("main").getByRole("link").first()).toBeVisible();
    await expect(page.locator("main")).toHaveScreenshot("help-grid.png");
  });

  test("legal centre cards", async ({ page }) => {
    await page.goto("/legal");
    await stabilize(page);
    await expect(page.locator("main")).toHaveScreenshot("legal-hub.png");
  });
});

test.describe("legal document chrome", () => {
  test("breadcrumb + meta row", async ({ page }) => {
    await page.goto("/legal/privacy");
    await stabilize(page);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveScreenshot(
      "legal-breadcrumb.png",
    );
  });

  test("table of contents (desktop)", async ({ page }, testInfo) => {
    test.skip(!isDesktop(testInfo.project.name), "TOC rail is desktop-only");
    await page.goto("/legal/privacy");
    await stabilize(page);
    await expect(page.getByRole("navigation", { name: "Table of contents" })).toHaveScreenshot(
      "legal-toc.png",
    );
  });

  test("related policies", async ({ page }) => {
    await page.goto("/legal/privacy");
    await stabilize(page);
    const related = page.getByRole("region", { name: /related policies/i });
    if (await related.count()) {
      await expect(related.first()).toHaveScreenshot("legal-related.png");
    }
  });
});
