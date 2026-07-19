# Public Layout Architecture & Governance

> The single source of truth for how every **public** page is laid out, and how
> that consistency is *enforced* so it cannot drift. If you are building or
> reviewing a public page, read this first.
>
> Source of truth: [`src/components/layout/public.tsx`](../src/components/layout/public.tsx)
> · Enforcement: [`tests/public-layout.test.ts`](../tests/public-layout.test.ts)
> (runs in the `unit` CI job, which the merge gate `needs`).

---

## 1. Philosophy

Public pages are **one product**. A visitor moving between the homepage, a
policy, the Help Centre, and Contact must never feel a "layout jump." To make
that guaranteed rather than aspirational:

- **Every layout value comes from one token map.** No page may hardcode a
  max-width, padding, margin, gap, or section rhythm.
- **Pages compose primitives, they don't build frames.** A page describes
  *content*; the shared primitives own the *frame*.
- **The rules are enforced by a test in CI**, not by good intentions.

Non-goals: this guide is about **layout architecture**, not brand, colour, or
typography (see [`DESIGN-SYSTEM.md`](./DESIGN-SYSTEM.md)).

---

## 2. Design tokens (the one source of truth)

All values live in the `layout` object in `src/components/layout/public.tsx`.
Change a value there and it changes everywhere.

| Token | Value | Used for |
|---|---|---|
| `layout.reading` | `max-w-3xl` (48rem) | long-form prose: About, policies, articles |
| `layout.wide` | `max-w-5xl` (64rem) | hubs, grids, nav, footer, legal shell |
| `layout.landing` | `max-w-6xl` (72rem) | homepage landing sections |
| `layout.hero` | `max-w-4xl` (56rem) | centred hero text blocks |
| `layout.paddingX` | `px-5 md:px-8` | standard horizontal page padding |
| `layout.landingPaddingX` | `px-6 md:px-10` | landing horizontal padding |
| `layout.heroPaddingX` | `px-6` | hero horizontal padding |
| `layout.paddingTop` | `pt-36 md:pt-44` | clears the floating navbar |
| `layout.paddingBottom` | `pb-20 md:pb-24` | page bottom |
| `layout.section` | `mt-20 md:mt-28` | vertical rhythm between sections |
| `layout.gridGap` | `gap-4` | card grid gap |

**No magic numbers. No duplicated widths. No duplicated spacing.** If you need a
value that isn't here, add it to this map (see §8), don't inline it.

---

## 3. Approved primitives (the only way to build a frame)

From `@/components/layout/public`:

| Primitive | Renders | Use it for |
|---|---|---|
| `<PageShell width="reading\|wide">` | `<div>` container with width + `paddingX` + page top/bottom padding | the outer wrapper of a public page |
| `<Container width="reading\|wide">` | width + `paddingX`, **no** page vertical padding | nav, footer, landing sections that own their vertical space |
| `<Section>` | shared section rhythm (`layout.section`) | a content section |
| `<CardGrid cols={2\|3}>` | responsive grid with `layout.gridGap` | card grids (Help, Safety, Legal Centre) |
| `<CTAGroup>` | CTA button row spacing | hero / footer CTA rows |

> **The `<main>` landmark is owned by the marketing layout.** `PageShell`
> renders a `<div>` on purpose - a page must never render its own `<main>`
> (two `<main>`s is an accessibility defect).

---

## 4. Container hierarchy

```
(marketing)/layout.tsx
  <MarketingNavbar/>            ← Container(wide) inside a floating capsule
  <main id="main-content">      ← the ONE <main>
    <PageShell width="reading|wide">   ← the page frame (per page)
      <Section> … </Section>
      <CardGrid> … </CardGrid>
      <CTAGroup> … </CTAGroup>
    </PageShell>
  </main>
  <MarketingFooter/>            ← Container(wide)
```

Nav, page content, and footer all resolve to the same width + `paddingX`
tokens, so their left/right edges align on every viewport.

---

## 5. Spacing & responsive strategy

- **One spacing scale.** Section rhythm is always `layout.section`. Page padding
  is always the padding tokens. No viewport gets its own philosophy - the same
  tokens carry `sm:`/`md:` responsive steps internally.
- **Breakpoints** covered by the tokens: mobile (base) → `sm:` → `md:` → large.
  You never write viewport-specific container logic in a page.

---

## 6. Forbidden patterns (rejected in code review **and** by CI)

The guard in `tests/public-layout.test.ts` fails the build if a public page or
shared chrome contains any of these:

| ❌ Forbidden | ✅ Instead |
|---|---|
| `<main className="…">` in a page | `<PageShell>` (the layout owns `<main>`) |
| `className="mx-auto max-w-3xl px-5 pt-36 …"` (a page frame) | `<PageShell width="reading">` |
| `className="mx-auto max-w-6xl px-6 md:px-10"` | `<Container width="wide">` or a `layout.landing` token |
| `className="mt-20 md:mt-28"` (raw section rhythm) | `<Section>` or `className={layout.section}` |
| a second `export const layout = …` | extend the one map in `public.tsx` |

**Allowed** (these are *content measure*, not layout frames): `max-w-lg`,
`max-w-md`, `max-w-sm`, `max-w-xs`, or a hero text block like
`mx-auto max-w-2xl text-center` **without** page padding. The guard only forbids
the *frame* signature (`mx-auto` + page width + `px-`).

---

## 7. Migration example (before → after)

```tsx
// ❌ Before - page defines its own frame + a nested <main>
export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 pt-36 pb-24 md:px-8 md:pt-44">
      <h1>About</h1>
      <section className="mt-20 md:mt-28"> … </section>
    </main>
  );
}

// ✅ After - inherits the frame + rhythm from the source of truth
import { PageShell, layout } from "@/components/layout/public";
export default function AboutPage() {
  return (
    <PageShell width="reading">
      <h1>About</h1>
      <section className={layout.section}> … </section>
    </PageShell>
  );
}
```

---

## 8. Future pages & extension rules

**A new public page should require almost no layout code:**

```tsx
import { PageShell, Section } from "@/components/layout/public";

export default function NewPage() {
  return (
    <PageShell width="reading">
      <h1>Title</h1>
      <Section labelledBy="x"> … </Section>
    </PageShell>
  );
}
```

No manual spacing. No custom container. No custom max-width.

**To extend the system** (only when genuinely needed): add the value to the
`layout` map in `public.tsx`, and if it's a new frame archetype, add it as a
`width` option to `PageShell`/`Container`. Update this guide and the guard's
allowed/forbidden lists. Never inline the value in a page.

---

## 9. Code-review checklist

Reject a PR that:

- adds a new `max-width`, container, or page wrapper in a page;
- hardcodes spacing (`mt-…`, `px-…`, `pt-…`) as a page frame;
- introduces a page-specific layout component or duplicated spacing utility;
- defines a second layout token source.

Approved alternative in every case: **compose the existing primitives/tokens.**
If the reviewer is unsure, the CI guard is the tiebreaker - if it passes, the
frame came from the source of truth.

---

## 10. Onboarding (new engineers)

1. Read §2–§3 (tokens + primitives).
2. Build any public page with `<PageShell>` + `<Section>` - copy §7's "after".
3. Run `npm run test:unit` locally; the `public-layout` guard tells you
   immediately if you drifted.
4. Never import a raw Tailwind width/padding for a page frame - reach for a
   primitive or a `layout.*` token.

Enforcement recap: `npm run ci` → `test:unit` → `public-layout.test.ts`; the
same runs in `.github/workflows/ci.yml` (the `unit` job, which the merge gate
`needs`). Layout drift cannot reach `main`.
