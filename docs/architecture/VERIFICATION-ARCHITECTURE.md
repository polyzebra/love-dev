# ADR — Tirvea Canonical Verification Architecture (L9.0)

- **Status:** `TARGET ARCHITECTURE` · `NOT YET ACTIVATED`
- **Type:** Architecture Decision Record (product specification)
- **Scope:** Identity & face verification, dating activation, the verified badge

> **This document defines the intended Tirvea verification architecture.
> Current production behavior may differ. Activation is blocked until the
> Legal & Compliance Gate (§8) is approved.**
>
> This document authorizes nothing. It is the single source of truth for
> *future* product direction; it does not change any runtime behavior, flag,
> migration, environment variable, or deployment. Where the repository differs
> today, the repository should evolve toward this document — not the reverse.

---

## 1. Canonical Registration & Activation Flow (target)

```
Email verification
      ↓
Phone verification
      ↓
Age confirmation
      ↓
Terms / Privacy / Community consent
      ↓
Onboarding
      ↓
AWS Face Liveness            ← primary identity check (live human capture)
      ↓
AWS Rekognition enrollment   ← creates the ONE canonical face reference
      ↓
Canonical Face Reference
      ↓
ACTIVE dating account        ← dating capabilities unlock here
      ↓
(optional) Stripe Identity   ← Blue Verified Badge + enhanced trust only
```

**AWS Face Liveness is the primary identity verification and the entry point to
dating features.** A user who has completed email, phone, age, legal consent and
onboarding is **not** yet able to use dating features; they become `ACTIVE` only
after a successful liveness capture and canonical face enrollment.

**Stripe Identity is NOT required to activate dating access.** It is an optional,
additional verification that exists solely for the Blue Verified Badge and
enhanced trust signals. Stripe Identity must never block AWS Face Liveness, the
`ACTIVE` status, or any dating feature.

---

## 2. Canonical Face Reference

AWS Rekognition owns **exactly one** canonical face reference per user, created
from the successful liveness capture and used for all subsequent face matching.

- The reference is versioned; only one active reference exists under the
  lifecycle contract; stale/replaced references invalidate stale per-photo checks.
- Gallery photos are **never** used as the canonical reference — the reference
  originates only from a live capture.
- "Face matching against the canonical AWS face reference" is described here
  **generically**. The implementation may use `SearchFacesByImage`,
  `CompareFaces`, `DetectFaces`, or an equivalent Rekognition service without
  changing this product architecture. (Today the runtime uses `SearchFacesByImage`
  + `DetectFaces`.)

---

## 3. Dating Activation

Dating access is unlocked **only** after a successful AWS Face Liveness capture
and canonical face enrollment. The gated capabilities are:

Swipe · Explore · Discovery · Likes · Matches · Chat · Realtime · First message ·
Push (dating activity) · Premium dating actions.

All of these must resolve through the **one** canonical capability resolver; no
route, worker, query, or RLS policy may independently reinterpret eligibility.

---

## 4. Stripe Identity (badge-only)

Stripe Identity:

- is **optional**;
- controls **only** the Blue Verified Badge and higher-trust identity signals;
- must **never** block AWS Face Liveness, `ACTIVE` status, or dating features.

---

## 5. Photo Reverification

Whenever a profile photo is added, replaced, or restored:

```
new / replaced photo
      ↓
face match against the canonical reference (no new liveness)
```

- **Sufficient confidence →** accept the photo, update verification metadata,
  **no repeated liveness**.
- **Insufficient confidence or elevated risk → request a repeat AWS Face
  Liveness.** Triggers: low confidence · different person · multiple faces ·
  spoof/manipulation risk · expired or invalid reference · manual-review request
  · risk-policy escalation.

A single failed match or a single failed liveness attempt results in
**retry / manual review** — never automatic suspension or ban.

Cover-vs-gallery policy: the cover photo must contain exactly one clear face
matching the reference; a non-face lifestyle photo may be permitted per gallery
policy but never counts as identity evidence and never restores the badge.

**Private until decided:** a new or replacement photo remains private (not shown
in Discovery/Explore/Swipe/Likes/Matches/Chat previews/caches) until it is
resolved. When replacing a verified photo, the old verified photo remains public
until the new one passes; on pass, swap atomically; on fail, keep the old photo.

---

## 6. Badge Behaviour

The Blue Verified Badge depends on **both**:

1. Stripe Identity, **and**
2. a current verified gallery state (`verifiedGalleryVersion === galleryVersion`).

If gallery verification becomes stale (a photo changed), the badge is **hidden
synchronously**, and **restored only after** a successful reverification advances
the verified gallery snapshot. Non-face photos never grant or restore the badge.

---

## 7. Rollout Strategy

Activation is **phased** — never enabled globally at once:

1. Internal / admin test accounts.
2. Feature-flag cohort.
3. Percentage rollout (`FACE_VERIFICATION_PERCENT`).
4. Full production rollout.

**Existing `ACTIVE` users are migrated intentionally and are never mass-locked.**
The migration must fail open for legacy users until the rollout policy migrates
them, so no production user loses access on deploy.

---

## 8. Legal & Compliance Gate (activation blocker)

This architecture remains **inactive** until all of the following are approved:

- an **approved DPIA** for face/biometric processing;
- a documented **lawful basis** for biometric (GDPR Art. 9) processing —
  including the necessity/proportionality basis for making it a condition of
  access, if activated as mandatory;
- required **AWS agreements** (executed DPA);
- **privacy review**;
- **security review**;
- **executive approval**.

The runtime already enforces a fail-closed compliance gate (`faceMatchLegalGate`,
attesting counsel-approved legal version + executed DPA + approved calibration +
kill-switch off). **This document does not satisfy or bypass that gate**, and
supplying version identifiers that do not correspond to real approvals is
explicitly out of scope. Activation is a separate, deliberate decision.

---

## 9. Current Implementation vs Target Architecture

Factual mapping of today's codebase to this target (no criticism implied):

### Already implemented
- Registration ladder (email → phone → email-attach → age → legal → onboarding)
  via the one canonical `authNextStep` + single activator `activateAccountIfComplete`.
- AWS Face Liveness capture (`CreateFaceLivenessSession`, STS `AssumeRole`
  streaming creds, `FaceLivenessDetectorCore`) — verified reachable against live AWS.
- AWS Rekognition (`DetectFaces`, `SearchFacesByImage`, `IndexFaces`) + the
  canonical reference model (`FaceReferenceRecord`, `ProfilePhotoVerification`).
- Photo reverification (§5): per-photo `PhotoFaceCheck`, the **no-repeat-liveness
  once a reference exists** invariant, and the decision model
  (NO_FACE / MULTIPLE_FACES / MATCH_FAILED / MANUAL_REVIEW).
- Badge (§6): `publicBadgeVisible` (Stripe + gallery-version) + synchronous
  suspension on gallery change + restore only via `snapshotVerifiedGallery`.
- Single-failure → retry / manual review, never auto-suspension (`decideProfile`;
  suspension is aggregate-only) — tested.
- Canonical capability resolver (`resolveAccountCapabilities`) with **dormant,
  forward-compat** `faceVerificationRequired` / `faceVerified` inputs for §3.
- Rollout controls (§7): `FACE_VERIFICATION_PERCENT` + internal allowlist.
- Security invariants (§Guiding Principles): STS/IAM least-privilege, `flowId`
  session-ownership binding, replay/single-run protection, gallery-version
  binding, verification state machine, badge invalidation, audit, kill switch.
- Compliance gate (§8): `faceMatchLegalGate` fail-closed in production.
- Operational: admin readiness dashboard + CI approval-status gate.

### Partially implemented
- Ordering: Stripe is already **non-blocking for dating** (§4 satisfied), but the
  first-time liveness CTA is currently gated behind Stripe identity
  (`getFaceVerificationAction` → `IDENTITY_FIRST`), whereas §1 places AWS-first,
  independent of Stripe.
- Per-photo badge cohort (`FACE_BADGE_PER_PHOTO`) exists but is off by default.

### Not implemented
- Mandatory AWS liveness as the **dating activation gate** (§2–3). An entry-gate
  version existed previously and was reverted; the `livenessPassedAt` column and a
  `PENDING_LIVENESS` state are not currently present.
- "Private until decided" **visibility enforcement** (§5) — new/replaced photos
  currently publish on moderation state, not on a face PASS.

### Deferred until activation (§8)
- Any production activation of the AWS provider/mandatory gate. Building the
  §2–3 gate is designed to be **schema-free** (derive "liveness passed" from the
  existing reference) and **flag-gated + fail-open** (per §7), and is deferred
  until the Legal & Compliance Gate is approved.

---

## 10. Guiding Principles

- **Single canonical face reference** — one owner, one resolver, no forks.
- **Least privilege** — scoped STS creds, IAM least-privilege, permissioned admin.
- **Replay protection & session ownership** — `flowId`-bound, single-run.
- **Auditability** — versioned, PII-minimized audit trail.
- **Privacy by design** — no biometric data / raw scores / secrets in logs or
  client responses; private-until-decided for changed photos.
- **Defense in depth** — runtime gate **and** deploy-time (CI) approval check.
- **Backward compatibility** — no schema-coupled login migrations; additive,
  nullable, reversible changes only.
- **Controlled rollout / no production surprises** — phased, fail-open for legacy
  users, never a mass lock.

---

## 11. Future Implementation Rules

Future verification work **must conform to this document**. If repository behavior
differs, the repository evolves toward this architecture, not the reverse. Any
change that would activate mandatory biometric processing, gate dating on
liveness, or enforce private-until-verified visibility must:

1. be flag-gated and fail-open by default (no mass lockout);
2. require no risky, login-coupled schema migration;
3. pass the CI approval-status gate; and
4. occur only after §8 approvals exist.
