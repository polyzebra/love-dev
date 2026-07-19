# Registration Lifecycle & Deferred Activation (L7.3.8)

> **The contract.** A Supabase Auth identity may exist early (after email OTP),
> but a **Tirvea application account is NOT ACTIVE until the whole registration
> ladder completes**. An account is born `PENDING`, is invisible and unusable,
> and is promoted to `ACTIVE` — with `registrationCompletedAt` stamped — by a
> single canonical activator only when every required step is done.

## The ladder (one canonical resolver)

`src/lib/auth/gate.ts` is the single source. `authNextStep(user)` decides the
next required step; `resolveRegistrationState`, `registrationComplete`, and
`registrationProgress` are all **derived from it**, so routing and state can
never disagree.

```
EMAIL_PENDING → PHONE_PENDING → LEGAL_PENDING → ONBOARDING_PENDING → ACTIVE
(overlays: BLOCKED = suspended/banned · CANCELLED = deactivated/deleted)
```

- `EMAIL_PENDING` — owes a first verified channel or a real verified email
- `PHONE_PENDING` — phone verification owed (only when the SMS provider is wired)
- `LEGAL_PENDING` — age confirmation and/or legal consent owed
- `ONBOARDING_PENDING` — profile onboarding owed
- `ACTIVE` — `registrationCompletedAt` stamped

No skipped transitions (the earliest owed rung wins). No backward transitions
except explicit admin recovery.

## Deferred activation

- New app rows are created `status = "PENDING"` (in `ensureAppUser` and
  `provisionPhoneLoginUser`).
- **`activateAccountIfComplete(userId, tx?)`** in `src/lib/auth/identity.ts` is
  the **only** code that stamps `registrationCompletedAt` / performs completion
  activation. Idempotent. Promotes `PENDING → ACTIVE` (leaves LIMITED/other
  restrictions intact) only when the field ladder is complete. Called from
  `completeOnboarding` (the terminal rung) inside its transaction.
- Persisted `registrationCompletedAt` is **authoritative for access**: a
  completed account is never retro-locked if a NEW rung is later added
  (existing users keep access). The activator decides via the *field* ladder
  (`registrationLadderComplete`) so it never depends on the stamp it sets.

## Access control

- `PENDING` is not in `DISCOVERABLE_STATUSES` and not `canEngage`, so a
  mid-registration account is **invisible** and **cannot swipe/chat/first-msg**
  (`src/lib/services/trust-safety.ts`). `DISCOVERABLE_USER_WHERE` also requires
  `onboardingDone`.
- **`requireActiveAccount()`** (`src/lib/api.ts`) = `requireSession` + the
  canonical `registrationComplete` → `403 registration_incomplete`. Every
  **post-activation feature route** uses it (billing, matches, conversations,
  notifications, push, presence, blocks, reports, discover, explore, swipes,
  first-messages).
- **Registration/setup routes keep plain `requireSession`** — they must run
  while the account is still incomplete (auth steps, onboarding, profile,
  photos, account management, `GET /api/v1/auth/registration`).

## Data model (additive, non-destructive)

New `User` columns: `registrationStartedAt`, `onboardingCompletedAt`,
`registrationCompletedAt` (all nullable, no DB default — set in code).
`AccountStatus` gains `PENDING`. Migrations:
`20260721100000_account_status_pending` (enum) and
`20260721110000_registration_lifecycle` (columns + safe backfill).

**Backfill (preserves every existing ACTIVE user):** `registrationStartedAt =
createdAt` for all; `registrationCompletedAt = createdAt` for every
`onboardingDone` account (grandfathered, never re-laddered); and the fix —
`status ACTIVE → PENDING` **only** where `onboardingDone = false` (the
prematurely-active accounts). No data deleted.

## API contract

`GET /api/v1/auth/registration` → `{ state, next, completed, percentComplete,
remaining[] }` (via `registrationProgress`). The same shape backs every
registration step response's `next`.

## Abandoned-registration cleanup

`cleanupAbandonedRegistrations` (in the `auth-cleanup` cron) deletes stalled
`PENDING` accounts by how far they got: EMAIL/PHONE 24h, LEGAL 48h, ONBOARDING
7 days. **Never** touches ACTIVE; **skips** anyone with a subscription or any
payment; the delete re-asserts `PENDING` + `registrationCompletedAt IS NULL`
(no race with a just-completed account).

## Governance (CI)

`tests/registration-governance.test.ts` fails CI if: a fresh account is created
ACTIVE; more than one implementation stamps `registrationCompletedAt`; PENDING
becomes discoverable/engageable; a feature route drops `requireActiveAccount`; a
setup route adds it (deadlock); or the sweeper targets ACTIVE.
`tests/registration-state-machine.test.ts` pins the resolver.
