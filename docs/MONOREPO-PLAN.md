# Monorepo Preparation (Phase 0L)

No conversion yet - this document maps exactly what would extract, the
boundaries are machine-pinned (`tests/architecture.test.ts`, "future
package boundaries" section), and the web app stays deployable
unchanged. Extraction happens later, one package at a time, behind the
gates below.

## Module -> package map

| Future package           | Today                                                                                                                                                                                                                                             | Dependencies                                                                                                                                       | Readiness                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/api-contract`  | `src/lib/api-contract/**`                                                                                                                                                                                                                         | zod only                                                                                                                                           | **ready** - zero app coupling                                                                                                         |
| `packages/api-client`    | `src/lib/api-client/index.ts`                                                                                                                                                                                                                     | zod + `../api-contract` (made relative in 0L)                                                                                                      | **ready**; `browser.ts` (web singleton) stays in `apps/web`                                                                           |
| `packages/validation`    | `src/lib/validators/**`                                                                                                                                                                                                                           | zod + `@/config/prompts`, `@/lib/discovery/taxonomy`, `@/lib/constants`, `@/generated/prisma/enums`                                                | blocked on core: the four edges must move to (or be re-exported from) `packages/core` first                                           |
| `packages/core`          | pure domain modules: `src/lib/chat/**` (thread-store), `src/lib/auth/transport.ts`, `src/lib/rbac.ts`, `src/lib/rate-limit.ts`, plus the product data the validators need (`config/prompts`, `discovery/taxonomy`, `constants`) and product enums | prisma-generated enums are the one impurity - on extraction, core owns the enum definitions and the Prisma schema consumes them (invert the arrow) | mapped; extract after api-contract/api-client prove the workflow                                                                      |
| `packages/design-tokens` | the 186 CSS custom properties in `src/app/globals.css` + `src/lib/motion.ts` timing/easing constants                                                                                                                                              | none                                                                                                                                               | mapped; split when a second app exists to consume them                                                                                |
| `packages/config`        | `eslint.config.*`, `tsconfig.json`, `prettier` settings, `scripts/run-tests.mjs` conventions                                                                                                                                                      | none                                                                                                                                               | mapped; extract alongside the first package                                                                                           |
| `apps/web`               | everything else - `src/app`, `src/components`, services, adapters, Prisma                                                                                                                                                                         | -                                                                                                                                                  | stays put; **services deliberately do NOT extract** (they own Prisma persistence; splitting them is app decomposition, not packaging) |

## What Phase 0L changed

1. `api-client -> api-contract` now imports RELATIVELY (was `@/lib/...`)
   - the pair extracts together or apart without a rewrite.
2. Hidden framework dependencies: none found in any candidate
   (0K's boundary tests already forbid Next/React/DOM in this layer;
   `api-client/browser.ts` and `lib/auth/phone-tools.ts` are classified
   app-layer glue and exempted by name).
3. Boundary pins added (CI-enforced): api-contract/api-client/chat/
   transport restricted to portable imports; validators pinned to their
   EXACT documented edge list so coupling cannot silently deepen.

## Extraction runbook (per package, later)

1. Gates - do not start unless ALL hold:
   - full suite green (`npm test` 37/37) and `npm run ci` green
   - the package's boundary pin passes (imports already portable)
   - no in-flight feature work touching the module
2. `git mv src/lib/<module> packages/<name>/src` - one package per
   commit, never a bulk move; history survives `git log --follow`
   (and `git subtree split` can produce a standalone history if a
   package ever needs its own repo).
3. Add `packages/<name>/package.json` (+ tsconfig extending
   `packages/config`), declare `workspaces` in the root package.json,
   and point the app at it via the workspace name; keep a temporary
   re-export shim at the old path for one commit if the import sweep is
   large.
4. `npm run ci` + full suite + `npm run perf:check` must pass; deploy
   preview must build on Vercel BEFORE merging (the app must remain
   deployable after every step).
5. Update the boundary pin to the package's new location in the same
   commit.

Recommended order: api-contract -> api-client -> config -> core ->
validation -> design-tokens. Turborepo (or plain npm workspaces) only
becomes worth adding at step "core" - two small packages do not justify
the tooling.
