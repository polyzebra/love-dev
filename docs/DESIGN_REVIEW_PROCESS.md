# Design Review Process

> How intentional visual changes get reviewed and approved, and how accidental
> ones are stopped. The visual gate makes "did the UI change?" an explicit,
> reviewable question on every PR.

## Principle

- **Accidental visual change → fails CI.** The `visual` job compares against
  committed baselines; any unexplained pixel movement fails and blocks merge.
- **Intentional visual change → reviewed baseline update.** Baselines are never
  auto-updated; a changed baseline is a diff a human approves.

## Workflow for an intentional UI change

```
1. Developer changes UI
2. npm run test:visual            → fails, shows what moved
3. npm run test:visual:report     → inspect expected | actual | diff (% + pixels)
4. Confirm the change is intended
5. npm run test:visual:update     → regenerate baselines (on the CI platform / Docker)
6. Commit code + new baselines together, in ONE PR
7. Reviewer sees the baseline diff in the PR and approves the visual delta
8. Merge (visual job now green)
```

Rule: **never** commit a baseline update without the code change that justifies
it, and **never** run `--update-snapshots` to "make CI pass" without reviewing
the diff first.

## Reviewer checklist

When a PR changes files under `tests/visual/__screenshots__/`:

- [ ] Is there a matching UI/code change in the same PR? (a lone baseline change
      is a red flag)
- [ ] Open the diffs — is every changed page/component change **intended**?
- [ ] Any *unintended* collateral (spacing, alignment, wrapping, overflow,
      focus ring, shadow) on a page you didn't mean to touch?
- [ ] Do the changes respect the layout tokens / `LAYOUT_GUIDE.md` (no new
      hardcoded frame)?
- [ ] Accessibility unaffected (focus visibility, semantics)?

When a PR does **not** touch baselines but the `visual` job **fails**: the change
is an unintended regression — fix the code, do not update the baseline.

## What the gate protects

Typography, spacing, padding, margins, container widths, grid alignment, hero
layout, navigation, footer, cards, buttons, icons, borders, radii, shadows,
transitions, focus rings, heading wrapping, responsive breakpoints, overflow,
unexpected scrollbars/wrapping/clipping, and layout shift — across every
configured viewport.

## Ownership

- Design-system owners approve baseline updates to shared primitives (nav,
  footer, hero, buttons, layout).
- Feature authors own baselines for their pages.
- CI (`.github/workflows/ci.yml` → `visual`, in the merge gate) is the backstop.
