# Virelsy Identity Architecture

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
   `https://virelsy.com/api/webhooks/supabase-auth`, header
   `x-webhook-secret: $SUPABASE_WEBHOOK_SECRET`.
2. Optional: disable public sign-ups if deletion should mean banned
   (otherwise use BlockedIdentity).

## Email-lookup policy
Identity lookups by email are forbidden. Remaining email usages, all allowed:
password reset + email verification (Supabase-owned), notification
delivery, seed fixtures, and the callback's email-conflict INTEGRITY
check (which never merges).
