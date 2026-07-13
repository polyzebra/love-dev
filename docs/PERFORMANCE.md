# Bundle & Startup Performance (Phase 0J)

Measured audit of the web client ahead of any Capacitor packaging - a
WebView pays today's JavaScript at every cold start.

## Tools

- `npm run perf:bundle` - route-level first-load JS (raw + gzip),
  measured from what a browser actually downloads (`next start` +
  script/modulepreload parsing; `noModule` legacy polyfills excluded).
  `--grep <needle>` locates a library across chunks.
- `npm run perf:check` - budget gate; part of `npm run ci` (a major
  regression on a critical route FAILS the build).
- `npm run perf:startup` - real-Chrome cold-load metrics per route
  (JS transferred, LCP, long tasks, INP proxy via event timing) plus a
  warm client-side transition measurement.

## Baseline -> optimized (gzip first-load JS)

| route          | before    | after        |
| -------------- | --------- | ------------ |
| `/login`       | 323.4 KB  | **261.3 KB** |
| `/login/phone` | 324.9 KB  | **292.0 KB** |
| `/login/email` | 263.6 KB* | 264.3 KB     |
| `/`            | 272.2 KB  | 273.2 KB     |

\* pre-fix numbers included the never-executed `noModule` polyfill chunk
(38.7 KB) on some routes; the before column is per the same corrected
accounting where applicable.

Startup (local prod server, cold cache, real Chrome): LCP 56-140 ms,
**0 long tasks**, INP proxy 16-64 ms on every measured route; warm
client transition / -> /login: ~93 ms, +14 KB route JS.

## What the audit found and what changed

1. **`@supabase/*` (~56 KB gz) sat in the login/marketing first load** -
   pulled in statically by 8 files that only use it inside click/submit
   handlers (OAuth, sign-out, password reset) or the chat channel hook.
   `supabaseBrowser()` is now lazy (dynamic import, cached promise):
   the module left every first-load graph. First use costs one ~50 ms
   fetch inside a user action - imperceptible.
2. **libphonenumber metadata (40 KB gz) was QUADRUPLICATED** - four auth
   components imported `libphonenumber-js` statically, so four route
   bundles each carried the metadata blob; `countries.ts` derived the
   country picker from the same blob at runtime. Now: the ISO->dial-code
   table is GENERATED at dev time (`scripts/generate-countries.mjs` ->
   `countries-data.ts`, zero metadata in client), and formatting/parsing
   loads once on demand via `lib/auth/phone-tools.ts` (core build +
   explicit metadata - the min build's interop shim hands broken
   metadata outside Next's static graph). Until the ~100 ms lazy load
   lands, inputs pass digits through unformatted (same characters, no
   layout shift) and validation awaits the real parser - verified
   pixel-identical formatting in real Chrome.
3. **Server-only leakage: none** - client chunks contain no Prisma, no
   secret-bearing modules (probed by signature).
4. **motion/react** - imported consistently (28 files, one specifier,
   one package version). Turbopack duplicates its ~45 KB into separate
   route graphs, which costs cross-route navigation bandwidth but NOT
   per-route first load or parse (each entry ships one copy). Motion
   stays: the auth/marketing entrances are deliberate product surfaces
   (see the auth-loading sagas) - removing or LazyMotion-splitting them
   is a behavior change, not a free win. Revisit when packaging assets
   locally in Capacitor (local files make duplication ~free).
5. **Route code splitting** already works (App Router per-route
   entries); admin/chat/billing surfaces never load on auth paths. The
   warm-transition measurement (+14 KB) confirms transitions ship only
   route-specific code.

## Budgets

See `BUDGETS_GZIP_KB` in `scripts/bundle-report.mjs`. Set ~8-10% above
optimized reality: `/` 300, `/login` 285, `/login/email` 290,
`/login/phone` 320. `npm run ci` fails when exceeded - raise a budget
only with a deliberate justification in the same commit.

## Regression guards

- No loading flicker introduced: no new Suspense boundaries, no
  fallback swaps - the lazy modules upgrade in place (formatting) or
  load inside user actions (supabase). The auth-loading pins
  (auth-form-stack/login-routes suites) still pass.
- Server rendering and a11y untouched: no component moved to
  client-only rendering; markup unchanged.
