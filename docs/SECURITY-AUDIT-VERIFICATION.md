# Verification Stack Security Audit (Phase 19, 2026-07)

Scope: authentication, authorization/RBAC, admin endpoints, webhooks,
queues, temporary URLs, cron jobs, service roles, environment/secrets,
least privilege. Method: source review + the pinned invariants in the
test suites (every "verified by" cite is executable).

## Findings

### Critical - none open in code

The two standing CRITICAL items are process, not code, and gate the
FACE layer only (tracked in the Production Readiness Review):
C-1 real face provider not implemented (mock/stub only);
C-2 DPIA + vendor DPA not executed. `FACE_MATCH_PROVIDER` unset in
production keeps the layer dormant until both close.

### High - none open

### Medium

| ID  | Finding                                        | Detail                                                                                                                                                                                                                                                                                                                                                   | Recommendation                                                                                                                                                      |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M-1 | Live production secrets on a developer machine | `.env` holds the live Stripe key, service-role key, webhook secrets. Single-developer reality, but one laptop compromise = production compromise.                                                                                                                                                                                                        | Move live values to a secret manager / Vercel-only; keep local `.env` on test-mode credentials.                                                                     |
| M-2 | No secret rotation schedule                    | Stripe keys, identity webhook secret, CRON_SECRET, AUTH_HASH_SALT have no documented rotation cadence or procedure.                                                                                                                                                                                                                                      | Add a rotation runbook entry (quarterly + on personnel/vendor events); webhook secrets rotate via parallel endpoints.                                               |
| M-3 | Risk double-counting via face violations       | Face-layer rejections create AccountViolations, which trust-engine already scores (`violation`, 15 pts) - the risk engine then ALSO adds `face_rejected` (20). A rejected user inflates ~35 pts from one event, pushing borderline profiles into higher bands. Conservative direction (more manual review, never auto-reject), but distorts calibration. | Exclude face-class violations from trust-engine's violation signal, or zero `RISK_W_FACE_REJECTED` once violations flow (config-only fix). Registered as debt TD-2. |
| M-4 | Ops alerts ride the user notification outbox   | If the outbox itself is broken, alerts about it are silent.                                                                                                                                                                                                                                                                                              | Add an external channel (email direct / webhook to a pager) for `provider_down` + `queue_stalled` classes.                                                          |

### Low

| ID  | Finding                                                     | Detail                                                                                                                                                       |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L-1 | `isFinalRejection` = "final" substring in reviewNote        | Documented tech debt since go-live; promote to a column when a second writer appears.                                                                        |
| L-2 | `TEST_ASSUME_MOCK=1` bypasses the dev-server-provider guard | Test-lane opt-in; harmless in CI (no live keys there) but a footgun on the one machine that has them. Documented in the runbook.                             |
| L-3 | `ProviderHealth.lastError` stores free text                 | Bounded (500 chars) and our writers pass normalized classes/codes only; a future writer could leak detail. Convention documented at the recorders.           |
| L-4 | Admin sessions have no second factor                        | RBAC is enforced everywhere (verified below), but an admin credential alone suffices. Acceptable at current team size; revisit before delegating moderation. |

### Resolved (verified by tests)

| ID   | Item                                                                                        | Verified by                                                              |
| ---- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| R-1  | Webhook signatures over raw body; unsigned/forged -> 401, zero mutation; replays idempotent | photo-verification (22), face-chaos replay check                         |
| R-2  | Dedicated Identity webhook secret (never billing's)                                         | photo-verification config gates                                          |
| R-3  | Live key outside production refused without explicit flag                                   | photo-verification guard matrix                                          |
| R-4  | Env-file duplicate-key divergence (Next last-wins vs dotenv first-wins)                     | duplicate-key lint in photo-verification                                 |
| R-5  | Stripe error opacity (status-only throws)                                                   | fixed: vendor error CODE now recorded to ProviderHealth + thrown message |
| R-6  | Admin endpoints RBAC-guarded (`requirePermission`) incl. face queue, metrics, support view  | route review + admin-authz suite                                         |
| R-7  | Cron endpoints fail closed on bearer                                                        | cron route review, auth suites                                           |
| R-8  | Media temporary URLs: 60s signed URLs, private buckets (Phase 0I)                           | api-0i suite                                                             |
| R-9  | No biometric values in logs/analytics/client payloads/admin UI/URLs                         | face-security + face-chaos privacy pins                                  |
| R-10 | Rate limits fail closed on paid endpoints, fail open on signature-gated webhooks            | rate-limit + api-0f suites                                               |

## Least-privilege review

- Supabase service-role key: server-side only (never NEXT_PUBLIC), used
  by auth-admin + storage paths; the 42501 seen on raw `storage.objects`
  SQL from local shows the DB role is NOT superuser (good).
- Admin RBAC: explicit permission table, no role inference
  (house rule); face actions need `verifications:review`, metrics
  `analytics:read`, support view `users:read` - three distinct scopes.
- Cron: bearer `CRON_SECRET`, fails closed when unset.
- Face vendor IAM (future): the runbook's foundation step scopes to six
  Rekognition actions + one S3 prefix - review at implementation.
