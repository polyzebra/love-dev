# Tirvea Design System (Phase A consolidation)

Single reference for phases B-E. Nothing here is new design - it names and
consolidates what already ships. Sources of truth: `src/app/globals.css`
(tokens, utilities), `src/lib/motion.ts` (motion), `src/components/ui/*`
(primitives).

## Identity (do not strip)

Aurora ambient light (`fx/aurora`), frosted `glass` / `glass-chip`
materials, `noise` film grain, editorial serif `font-display` (Playfair),
rose brand reserved for brand moments (CTA, Like, match, premium). Dark
"cinematic luxury" is the default theme; light is warm ivory.

## Color tokens

Theme values live on `:root` (dark) and `.light`; utilities come from
`@theme inline`. Semantic aliases added in Phase A (same values, clearer
intent):

| Semantic                 | Alias of                             | Utility                                       |
| ------------------------ | ------------------------------------ | --------------------------------------------- |
| background               | `--background`                       | `bg-background`                               |
| surface                  | `--card`                             | `bg-surface` (= `bg-card`)                    |
| surface-elevated         | `--popover`                          | `bg-surface-elevated`                         |
| text primary             | `--foreground`                       | `text-foreground`                             |
| text secondary           | `--muted-foreground`                 | `text-muted-foreground`                       |
| text muted               | (convention)                         | `text-muted-foreground/70`                    |
| border                   | `--border`                           | `border-border` (default on `*`)              |
| border-strong            | `--input`                            | `border-border-strong` (= `border-input`)     |
| brand                    | `--primary` #e11d48                  | `bg-brand` / `text-brand`                     |
| brand-bright             | `--brand-bright` #fb4a6e             | `from-brand-bright` (CTA gradient top)        |
| brand-hover              | `--brand-hover` #be123c              | `to-brand-hover` (darker stop)                |
| brand-active             | `--brand-active` #a3123a             | `to-brand-active` (CTA gradient base)         |
| success / warning / info | `--success` / `--warning` / `--info` | `text-success` etc.                           |
| danger                   | `--destructive`                      | `bg-danger` (= `bg-destructive`)              |
| focus-ring               | derived                              | see Focus below - prefer `ring-foreground/20` |

Notes:

- The brand scale is THEME-INVARIANT: brand moments render identically in
  light and dark. Every other alias inherits the intentional per-theme
  values of the token it aliases (no auto-inversion anywhere).
- `--info` is new (dark `#22d3ee` / light `#0e7490`, matching chart-5).
- Brand color at alpha inside shadows/gradients is written as
  `color-mix(in srgb, var(--primary) N%, transparent)` - never
  `rgba(225,29,72,x)` literals.

### Sanctioned literals (do not "fix")

- Google logo hexes, PWA `themeColor` metadata, per-user generated HSL
  avatars, black scrims/shadows over photos, white inset highlights over
  photos (stronger than `--glass-highlight` by design).
- `swipe-deck` animated `boxShadow` strings stay `rgba(...)` - motion
  cannot interpolate `color-mix()`.
- Chat "own bubble" gradient top stop `#f43f5e` (pairs with
  `to-brand-hover`); trust meter gold stop `#e7c9a1` (theme-invariant on
  purpose - `--gold` changes per theme).

## House recipes

- CTA: `bg-linear-160 from-brand-bright via-brand to-brand-active` +
  inset white highlight + rose glow (see `ui/button.tsx` default variant).
  Reuse the Button; do not re-roll the recipe.
- Rose glow shadows are per-component recipes built on
  `color-mix(...var(--primary)...)`; `shadow-glow` (`--glow-rose`) is the
  generic brand glow.

## Typography

`font-sans` Inter, `font-display` Playfair. Scale (documented in
globals.css): display (4xl-6xl hero) / page title (2xl-3xl) / section
(lg-xl) / body (base, md:text-sm dense) / small (sm) / caption (xs muted) /
label + button (sm medium). `font-display` never on small labels, form
controls, buttons, table cells or dense admin rows. Large display stat
numerals in admin KPIs are sanctioned.

## Radius / spacing / z-index

- Radius scale (from `--radius` 1.5rem): sm 14 / md 18 / lg 24 / xl 28 /
  2xl 32 / 3xl 38 / full. Arbitrary `rounded-[Npx]` only for sanctioned
  one-offs: chat bubbles 22px, composer 26px, hero panels 36px.
- Spacing: Tailwind 4px grid; `tap-target` utility = 44px min hit area.
- Z-index tiers (documented in globals.css): 10/20/30 in-page, 40 app
  chrome, 50 Radix overlays, 60 progress bars, 70 full-screen viewers.
  Do not invent tiers.

## Focus (settled - do not reinterpret)

- Form fields: `hover:border-foreground/25`,
  `focus-visible:border-foreground/30 focus-visible:ring-0`. Zero glow.
- Interactive controls: `focus-visible:ring-2 focus-visible:ring-foreground/20`
  (use `ring-inset` inside `overflow-hidden` list rows).
- Destructive styles ONLY behind `aria-invalid:`.
- Rose/`--ring` NEVER appears on focus or selection - it reads as red.
- Sanctioned exception: controls rendered over photos use
  `focus-visible:ring-white/60` (swipe deck, photo manager).

## Motion (`src/lib/motion.ts`)

- Easings: `EASE_LUXE`/`standardEase` (expo-out house curve), `subtleEase`
  (small fades).
- Durations: `DURATIONS.instant .1 / fast .16 / standard .24 /
deliberate .34`.
- Springs: `SPRING.soft|standard|snappy|bounce`; aliases `softSpring`,
  `cardSpring`, plus `sheetSpring` (260/30) for large surfaces.
- Animate: modals/sheets, tab indicators, card stack, match moment
  (`SPRING.bounce` - the only overshoot), notifications, expandables,
  skeleton-to-content crossfades. Do NOT animate: body text, tables,
  settings rows, form fields, hover transforms on non-interactive
  surfaces.
- Reduced motion: `MotionProvider` (`MotionConfig reducedMotion="user"`)
  wraps the app in the root layout. Components driving their own motion
  values (`useSpring`/`useScroll`) must self-gate with `useReducedMotion`
  (tilt-card, magnetic do; Reveal/OtpInput gate their variants).
- Known debt for later phases: many call sites still hand-write spring
  literals that duplicate `SPRING.*` values (see swipe-deck, hero-scene,
  onboarding-wizard, app-nav, navbar). Migrate opportunistically when a
  phase touches the file - do not mass-retrofit.

## Primitives

- Bottom sheet: `ui/drawer.tsx` (vaul) is THE sheet primitive; it owns
  safe-area bottom padding - sheets must not re-add `var(--safe-bottom)`.
  The unused Radix `ui/sheet.tsx` was removed. Vaul animates via CSS, so
  `sheetSpring` applies to motion-driven sheets/panels only.
- Modal: `ui/dialog.tsx`. Full-screen viewers (profile viewer, explore
  fullscreen) are hand-rolled `fixed inset-0 z-[70]` overlays - known,
  sanctioned.
- Skeleton: `ui/skeleton.tsx` - must mirror final layout shapes; swap in
  with an opacity-only crossfade. Quiet flows keep `PageLoader`.
- Empty state: `shared/empty-state.tsx` for page-level emptiness. Dense
  admin tables keep their inline "no rows" text (denser register).
- Status chips: use `Badge` + the status->variant maps in
  `src/app/admin/safety-badges.ts` (severity, case, enforcement, appeal,
  account). Billing keeps its local `PAYMENT_BADGE`. Vocabulary:
  destructive = punitive/failed, default (rose) = needs attention,
  secondary = healthy/active, outline = terminal/neutral. Do not define
  new local maps; extend safety-badges.ts.
- Touch targets: control library is a 36px (`h-9`) rhythm; only `tap-target`
  wrapped controls meet 44px. Known debt - phases B-D should wrap or pad
  small controls (checkbox/radio/switch/slider are 16-18px) rather than
  resize them visually.
