# Component Visual Testing

> How reusable UI components get isolated, deterministic visual baselines, and
> the state matrix each should cover. Companion to
> [`VISUAL_REGRESSION_GUIDE.md`](./VISUAL_REGRESSION_GUIDE.md).

## Strategy: snapshot in context, by role

Public-surface components are snapshotted **in context** on the real routes that
render them, targeted by role-based locators (`getByRole`, `aria-label`). This
keeps the styles real (tokens, theme, layout) and survives DOM refactors, and
needs no extra build step. See `tests/visual/components.spec.ts`.

```ts
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
```

## Interaction-state matrix

Capture the states that actually exist for a component:

| State | How | Example |
|---|---|---|
| default | render | every component |
| hover | `locator.hover()` | buttons, cards, related links |
| focus | `locator.focus()` | buttons, inputs, links (focus ring) |
| active | `page.mouse.down()` | pressable cards |
| disabled | render disabled variant | submit-while-sending |
| loading | trigger + freeze | submit button spinner |
| error | invalid submit | contact form errors |
| success | complete flow | contact form success |
| selected | set state | active TOC item, category chip |

Cross-cutting (from config): **dark mode** (default), **reduced motion**
(emulated). Add **light mode** / **high contrast** as new projects when shipped.

## Covered today (public surface)

Navbar, mobile drawer, footer, marketing hero, primary/outline buttons
(default/hover/focus), contact form (default/errors — inputs, textarea, select,
character counter), help card grid, legal-centre cards, legal breadcrumb, legal
TOC, related-policy links.

## App-internal components (future extension)

Chat (message bubbles, conversation list, composer), profile (avatar,
verification badge, identity/photo status), match cards, and safety dialogs
(report/block/appeal) live behind authentication and are **not** on the public
surface. Protect them with the same framework via a **guarded component gallery
route** that renders each component in every state with seeded fixture data:

```
/dev/gallery            ← dev/preview-only, gated; renders all components + states
tests/visual/gallery.spec.ts  ← snapshots each gallery section by id
```

This keeps app components deterministic (fixture data, no live DB) while reusing
the exact same config, determinism helpers, and CI gate.

## Adding a component

1. Render it on a real route (or the gallery).
2. Add a `test(...)` in `components.spec.ts` targeting it by role, plus its
   real interaction states.
3. Generate the baseline on CI/Docker and commit it with the change.
