# Visual Regression — the Design Quality Gate

> Tirvea's UI cannot visually regress without failing CI. Every important public
> page and every reusable public component has a committed pixel baseline;
> Playwright compares against it on every PR, and the `visual` job is part of the
> merge gate. This guide is the architecture + workflow.
>
> Config: [`playwright.config.ts`](../playwright.config.ts) · Specs:
> [`tests/visual/`](../tests/visual) · Baselines:
> `tests/visual/__screenshots__/` (committed).

---

## 1. Architecture

- **Runner:** `@playwright/test` with `toHaveScreenshot()` — deterministic
  screenshots, built-in `expected / actual / diff` PNGs, HTML report, sharding.
- **Determinism** (why snapshots are stable):
  - one colour scheme (`dark`), one `timezoneId` (`UTC`), one `locale` (`en-GB`);
  - animations frozen (`animations: "disabled"` + a CSS reset injected by
    `stabilize()`), reduced motion emulated, carets hidden;
  - fonts are self-hosted (`next/font`) → no network font race; `stabilize()`
    awaits `document.fonts.ready`;
  - fixed viewports (one Playwright *project* per breakpoint), `scale: "css"`,
    `deviceScaleFactor: 1`;
  - non-deterministic regions (external images, the hero scene, the footer's
    current-year line) are **masked** (`dynamicMasks()`).
- **Tolerance:** `maxDiffPixelRatio: 0.01` absorbs sub-pixel AA noise; a real
  layout/spacing/typography change moves far more than 1% of pixels and fails.
- **Server:** `webServer` boots `next start` on port 3230 against the production
  build (public pages need no DB; pricing reads `auth()` → null when logged out).

## 2. Coverage

- **Pages** (`tests/visual/pages.spec.ts`): home, about, pricing, safety, help,
  legal hub, and the key policies (privacy, terms, cookies, community, trust &
  safety, acceptable use, identity/photo verification, security, compliance,
  legal contact), contact, careers, press, and the 404 — full-page, every
  viewport.
- **Components** (`tests/visual/components.spec.ts`): navbar, footer, mobile
  drawer, hero, buttons (default/hover/focus, outline), contact form
  (default/errors), help + legal card grids, and the legal document chrome
  (breadcrumb, TOC, related) — in context, every viewport, with interaction
  states.
- **Viewports** (config `projects`): 390 (mobile), 768 (tablet), 1280 / 1440
  (desktop), 1600 (large). Specs are viewport-agnostic, so adding a breakpoint
  is one line in `playwright.config.ts` and instantly covers everything.

## 3. Baselines are platform-specific — generate them in CI

Font anti-aliasing differs between macOS and Linux, so a baseline captured on a
laptop will not match the Ubuntu CI runner. **The committed baselines are the
Linux ones.** Generate/update them on the CI platform:

```bash
# Recommended: reproduce the CI environment (Ubuntu) via the Playwright image
docker run --rm --network host -v "$PWD:/w" -w /w \
  mcr.microsoft.com/playwright:v1.56.0-jammy \
  bash -c "npm ci && npm run build & npx wait-on http://localhost:3230 && npm run test:visual:update"
```

Locally on macOS you can still run `npm run test:visual` against
macOS-generated baselines to iterate, but only the Linux baselines are
committed and gate CI.

## 4. Developer workflow (updating a baseline is a deliberate act)

Baselines are **never** overwritten automatically. When you intentionally change
the UI:

1. Make your change.
2. `npm run test:visual` → it fails and shows exactly what moved.
3. Inspect the diff: `npm run test:visual:report` (HTML: expected | actual |
   diff with highlighted pixels + % difference).
4. If the change is intended, regenerate the baseline **on the CI platform**
   (`npm run test:visual:update`, ideally via the Docker image above).
5. Commit the new baseline **with** the code change, in the same PR, so a
   reviewer sees the visual delta.

## 5. CI integration

- `.github/workflows/ci.yml` → job **`visual`** (Ubuntu): `npm ci` →
  `playwright install --with-deps chromium` → `npm run build` →
  `npm run test:visual`. On failure it uploads the HTML report + diffs as an
  artifact.
- The merge gate `deploy.needs` includes `visual` → **no PR merges with an
  unexplained visual regression.**
- `npm run ci` runs `test:visual` last, so the full gate is reproducible
  locally.

## 6. Best practices

- Prefer masking a genuinely dynamic region over loosening the threshold.
- Snapshot components via role-based locators (`getByRole`) so they survive DOM
  refactors.
- Keep a new page/component covered by adding a target to the arrays in the
  specs — no new config.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| "Executable doesn't exist … headless_shell" | `npx playwright install chromium chromium-headless-shell` |
| Every snapshot fails after a machine change | baselines are platform-specific — regenerate on CI/Docker |
| One region flaps | add it to `dynamicMasks()` (external image, clock, canvas) |
| Timeouts on a page | ensure `npm run build` ran; the page may need `waitUntil: "networkidle"` |

## 8. Future extension

- Add app-internal component coverage via an authenticated **component gallery**
  route (see `COMPONENT_VISUAL_TESTING.md`).
- Add a **light-mode** project (`colorScheme: "light"`) and a **high-contrast**
  project when those themes ship.
- Shard across more CI workers as coverage grows (`--shard=1/4`).
