# Tirvea Identity Architecture

## Principle
There is exactly ONE identity source: **Supabase Auth (`auth.users.id`)**.
The app `User` table is profile data whose lifecycle follows it. Email,
cookies, local storage and profile rows are never identity.

    auth.users.id  ──1:1──▶  public."User".id  ──▶  Profile / Matches / Chats / ...

## Lifecycle

### Creation
    Browser ── signUp / signInWithOAuth ──▶ Supabase Auth (creates auth.users row)
        │                                        │ code
        ▼                                        ▼
    /auth/callback ── exchangeCodeForSession ──▶ session cookie
        │  blocklist check (BlockedIdentity by email+provider) ── blocked ─▶ signOut + /login?error=AccountBlocked
        │  existing app row for auth.uid? ── DELETED/SUSPENDED ─▶ signOut + AccountBlocked
        │                                └─ ACTIVE ─▶ sync email, continue
        └─ none: if email held by a DELETED row → tombstone it (deleted+<id>@tombstone…)
                 if email held by an ACTIVE row → AccountConflict (never merge)
                 else CREATE app User { id = auth.uid }   ← the ONLY creation point
App-row creation exists nowhere else (not middleware, layouts, pages, auth()).

### Login (every protected request)
    middleware (proxy.ts): supabase.auth.getUser() ── fails ─▶ purge sb-* cookies + redirect /login
        ▼
    requireUser() → auth():
      1 getUser() (server-validated JWT)      4 status not DELETED
      2 auth user exists                       5 status not SUSPENDED
      3 app User row exists (findUnique by id) 6 blocklist (when row missing)
      any failure → supabase.auth.signOut() + null → redirect /login
      onboarding gate in (app) layout; role gate in requireAdmin()

### Logout
    signOutEverywhere(): supabase.auth.signOut() → cookies cleared → /

### Deletion (dashboard, admin, or GDPR)
    auth.users deleted
        ▼ Database Webhook (auth.users, DELETE) + x-webhook-secret
    POST /api/webhooks/supabase-auth
        ▼ teardownAccount(id):
          status=DELETED · email→tombstone · profile hidden ·
          devices/push deleted · notifications deleted ·
          deletionRequested=now (30-day GDPR hard-delete job)
    Any surviving cookie dies at the next request (getUser fails → purge).

### No resurrection
A deleted email signing in again is a NEW auth.uid ⇒ a NEW empty account.
The old (tombstoned) row keeps nothing reachable. Restoration is an
explicit admin action only.

### Suspension
Admin sets status=SUSPENDED → next request: auth() rejects, signs out.

### Recovery (admin-only)
Admin may re-point a torn-down row to a new auth.uid manually; no code
path does this automatically.

## Setup required (Supabase dashboard)
1. Database → Webhooks: table `auth.users`, events INSERT/UPDATE/DELETE →
   `https://tirvea.com/api/webhooks/supabase-auth`, header
   `x-webhook-secret: $SUPABASE_WEBHOOK_SECRET`.
2. Optional: disable public sign-ups if deletion should mean banned
   (otherwise use BlockedIdentity).

## Phone-number lifecycle on deletion
Policy: **hard-delete + tombstone stays the model.** A verified phone is
an auth factor tied to exactly one account (`User.phoneE164 @unique`),
and it is FREED when the account dies - on both stores - so the person
(or anyone else legitimately holding the number) can verify it again on
a new account. Attachment always requires a fresh OTP; no code path ever
moves a number between accounts directly.

Both deletion paths free the number:
- **teardownAccount** (in-app deletion, webhook, orphan takeover): NULLs
  every phone column on the app row in the teardown transaction, then
  best-effort clears `auth.users.phone` for the SAME uid (same-database
  UPDATE - GoTrue's admin API cannot NULL a phone) and records an
  `phone_released_on_teardown` AuthVerificationEvent.
- **Dashboard deletion without the webhook** leaves an orphan: an app row
  whose `auth.users` identity is gone. Such a holder is *conclusively not
  a live account* (`isReleasablePhoneHolder`: status DELETED, or
  `isAuthUserAlive` false - fails SAFE to "alive"). When it blocks a
  claim, the flows auto-release it, the phone twin of `ensureAppUser`'s
  email-orphan takeover:
  - phone-change send/verify (`phone-flow.ts`): dead holder -> audited
    teardown (`phone_holder_auto_released`) and the claim proceeds; a
    LIVE holder still gets the neutral 409 `duplicate_phone`.
  - phone-login bridge (`phone-login-flow.ts`): dead owner -> audited
    teardown, then the login proceeds as a fresh phone-keyed signup.
- **Admin release from a deleted account** (`releaseDeletedUserPhone`,
  supers-only route `release-deleted-phone`, rbac `phones:release`):
  transactional (row locked FOR UPDATE), aborts with typed errors on any
  ambiguity (live holder, holder mismatch, concurrent change), clears the
  app claim + the same-uid `auth.users.phone` mirror, preserves all audit
  rows/messages/photos, and NEVER attaches - an optional `newOwnerUserId`
  is validated (exists + verified email) only; the new owner must verify
  via the normal fresh-OTP flow. Audited as AdminLog
  `admin.phone.release-deleted` (masked number) + AuthVerificationEvent
  `admin_release_deleted_phone`. The existing `releasePhone`
  (users:manage) remains the tool for LIVE accounts.

## Email-lookup policy
Identity lookups by email are forbidden. Remaining email usages, all allowed:
password reset + email verification (Supabase-owned), notification
delivery, seed fixtures, and the callback's email-conflict INTEGRITY
check (which never merges).

## Two emails = two accounts (identity linking)
One email = one account, by design. A person who signs in with Google
account `alice.a@gmail.com` and separately email-OTPs `alice.b@gmail.com`
holds TWO canonical accounts - two `auth.users` rows, two app `User` rows.
That is correct behavior, not a bug, and it is the usual real cause behind
"my phone number is already verified on another account" (the 409
`duplicate_phone`): the number was verified on the OTHER account. The
routes log a console-only diagnostic on every 409
(`authUserId=appUserId=... phoneOwner=... provider=...`) so support can
see both ids instantly; the UI copy stays neutral.

How identities relate on ONE account:
- Supabase links a NEW provider sign-in to an EXISTING `auth.users` row
  automatically only when the incoming identity's email matches that
  row's confirmed email. Example: email-OTP `alice.b@gmail.com` first,
  then Google sign-in with the same `alice.b@gmail.com` - one uid, two
  rows in `auth.identities`.
- Different emails NEVER auto-link. Manual linking is possible with
  `supabase.auth.linkIdentity()` while signed in - see
  docs/AUTH-SETUP.md "Linking Google to an existing account". Tirvea
  ships no linking UI today; phone conflicts are resolved by signing in
  to the account that owns the number (or using a different number).
- Accounts are never merged server-side. `ensureAppUser` rejects an
  email held by a live foreign account (`AccountConflict`) and its
  update path never touches phone columns - a verified phone can only
  move accounts by admin release (`releasePhone`) + re-verification.
