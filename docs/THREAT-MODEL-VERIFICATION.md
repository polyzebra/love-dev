# Photo Verification Threat Model (STRIDE) + Risk Model

Scope: identity verification (Stripe Identity), profile-photo
verification (face layer), the public verified badge, and the
supporting pipeline (webhooks, queue, cron, admin). Companion docs:
FACE-VERIFICATION.md (architecture), FACE-REFERENCE-AUDIT.md (reference
source), FACE-VERIFICATION-RUNBOOK.md (operations).

Legend - Likelihood/Impact: L low, M medium, H high.
Layers: `stripe` (hosted IDV), `liveness` (reference capture),
`facematch` (per-photo checks), `dupe` (likeness search), `risk`
(risk-engine), `platform` (auth/rate-limit/webhook infra), `human`
(manual review).

## Attack catalogue

| #   | Attack                 | Description                                       | Lik. | Imp. | Detection layer           | Mitigation                                                                                                                                                                                      | Residual risk                                                                                 |
| --- | ---------------------- | ------------------------------------------------- | ---- | ---- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | Printed photo          | Paper photo held to camera during selfie/liveness | H    | H    | stripe, liveness          | Stripe live-capture requirement; Face Liveness (motion/depth challenges) at reference capture                                                                                                   | Low - commodity attack, both layers built for it                                              |
| 2   | Phone screen replay    | Photo/video replayed from a second phone          | H    | H    | stripe, liveness          | Same as #1 + screen-artifact detection (moire/reflection)                                                                                                                                       | Low-Med for high-quality OLED replays                                                         |
| 3   | Tablet replay          | Larger-screen replay to fill the frame            | M    | H    | stripe, liveness          | Same as #2                                                                                                                                                                                      | Low-Med                                                                                       |
| 4   | Deepfake video         | Real-time face reenactment into the camera feed   | M    | H    | liveness, facematch, risk | Certified liveness challenges; MANIPULATION_RISK classification on gallery; virtual-camera injection is mitigated on native, weaker on web                                                      | **Medium - strongest current attack class; monitor vendor PAD certifications**                |
| 5   | AI-generated face      | Fully synthetic person as profile owner           | M    | H    | stripe, facematch         | Synthetic faces cannot pass document+selfie at Stripe; `aiGeneratedScore` in photo moderation; MANIPULATION_RISK on gallery                                                                     | Low for badge (needs a real document); Med for unverified profiles                            |
| 6   | Face swap              | Victim's face composited onto attacker's photos   | M    | H    | facematch, human          | Reference is liveness-bound; swapped gallery photos fail cover match or hit MANIPULATION_RISK -> manual review                                                                                  | Medium - quality swaps can read as UNCERTAIN; humans decide                                   |
| 7   | Morph attack           | Blended face passing as two people                | L    | H    | stripe, dupe              | Document photo <-> selfie match at Stripe resists morphs on the ID side; duplicate-likeness search flags shared-face accounts                                                                   | Medium-low; specialised morph detection not deployed                                          |
| 8   | Mask attack (3D)       | Silicone/printed mask of the victim               | L    | H    | liveness                  | Face Liveness PAD (presentation-attack detection) challenges                                                                                                                                    | Medium-low - high-end masks are a known industry gap                                          |
| 9   | Stolen profile photos  | Catfish uploads someone else's photos             | H    | H    | facematch                 | THE core case: cover must match the liveness-bound reference; confident mismatch fails CLOSED; gallery OTHER_PERSON_ONLY flags + aggregate suspension                                           | Low once face layer is live (today: Stripe-only, gallery unbound)                             |
| 10  | Duplicate accounts     | One person, many verified accounts                | M    | M    | dupe, risk                | Likeness search -> LIKELY_DUPLICATE -> manual review; device/email/phone reuse signals in trust-engine                                                                                          | Medium - policy decision, not auto-punished (twins exist)                                     |
| 11  | Account takeover       | Attacker controls a verified account              | M    | H    | risk, platform            | Auth hardening (OTP policy, session invalidation); photo CHANGES re-enter review - a hijacker swapping photos loses the badge to `photo_update_review`; behaviour anomalies raise the risk band | Medium - depends on auth layer; badge self-heals on photo swap                                |
| 12  | Fake cover photo       | Verified user sets a non-self cover               | H    | M    | facematch                 | Cover policy: exactly one dominant matching face; REJECTED -> action_required, badge withheld                                                                                                   | Low                                                                                           |
| 13  | Fake gallery photos    | Mixing other people into the gallery              | H    | M    | facematch                 | Per-photo classification; OTHER_PERSON_ONLY flags; cap -> suspension; no-face lifestyle photos stay allowed                                                                                     | Low-Med (group-photo edge cases go to humans)                                                 |
| 14  | Synthetic identity     | Real-looking fake person + forged document        | L    | H    | stripe                    | Stripe document authenticity + issuing-DB checks + Synthetic Identity Protection (enabled)                                                                                                      | Medium-low - nation-state grade forgery out of scope                                          |
| 15  | Emulator               | Android emulator running the app                  | M    | M    | platform, liveness        | Web-first product (no APK to emulate today); liveness vendors detect virtual cameras/emulated sensors; velocity + device-fingerprint signals                                                    | Medium until native apps ship with attestation (Play Integrity/DeviceCheck - Capacitor phase) |
| 16  | Rooted Android         | Hooking frameworks feeding fake camera            | M    | M    | liveness, risk            | Same as #15; native phase must add integrity attestation                                                                                                                                        | Medium (web), planned (native)                                                                |
| 17  | Jailbroken iPhone      | Same on iOS                                       | L    | M    | liveness, risk            | Same as #16                                                                                                                                                                                     | Medium (web), planned (native)                                                                |
| 18  | Automation             | Scripted flows driving verification APIs          | M    | M    | platform                  | Fail-closed rate limits on start (5/h/user); auth required everywhere; liveness inherently interactive                                                                                          | Low                                                                                           |
| 19  | Bot farms              | Many humans/bots running cheap verifications      | M    | M    | platform, risk            | Stripe costs money per attempt (economic brake); velocity/device/IP-reputation signals; risk gate holds CRITICAL profiles                                                                       | Medium - determined farms absorb cost                                                         |
| 20  | Mass account creation  | Registration flooding for later abuse             | H    | M    | platform, risk            | OTP-gated signup, per-IP-hash velocity limits, disposable-email signals, phone reuse bans                                                                                                       | Low-Med                                                                                       |
| 21  | Stolen Stripe identity | Attacker verifies with a stolen REAL document     | L    | H    | stripe, facematch, dupe   | Stripe selfie<->document binds the session to the document holder's face; attacker's gallery then can't match the victim's photos; duplicate search catches the victim's real account           | Medium-low - document+face theft together defeats layer 1; face layer contains blast radius   |
| 22  | Replay attacks (API)   | Re-sending captured API requests                  | M    | L    | platform                  | TLS everywhere; session auth; idempotent outcome application (same webhook/poll replayed = no-op)                                                                                               | Low                                                                                           |
| 23  | Webhook replay         | Re-delivering a captured signed webhook           | M    | L    | platform                  | Stripe signature includes a timestamp (tolerance-checked); `applyVerificationOutcome` idempotence: replays answer `already_applied`, zero state change (tested)                                 | Low                                                                                           |
| 24  | API abuse              | Enumeration, quota burn, forced provider spend    | M    | M    | platform                  | Fail-closed rate limit on paid endpoints; 401-first webhook; admin RBAC; risk signals on repeat failures                                                                                        | Low                                                                                           |

## STRIDE mapping

- **Spoofing**: #1-#9, #14, #21 - liveness + document verification +
  face match; identity is never granted on client-side claims.
- **Tampering**: #6, #11, #12, #13 - immutable `mediaVersion` pinning
  (a replaced image ALWAYS re-verifies), transactional verdicts,
  `VerificationAuditEvent` append-only trail.
- **Repudiation**: every decision (system, admin, appeal) writes an
  immutable audit event with actor type/id, previous/new status and a
  reason code; appeal timelines (AppealEvent) only ever grow.
- **Information disclosure**: no biometric vectors at Tirvea; raw
  similarity confined to the DB internals; admin/API/client surfaces
  carry bands + reason codes only (pinned by tests); provider reference
  ids never leave the server.
- **Denial of service**: fail-closed limits on paid endpoints,
  fail-open limits on webhooks (signature is the real gate), cron
  recovery for lost jobs; provider outages park jobs (never grant).
- **Elevation of privilege**: RBAC on every admin action; cron routes
  bearer-gated; the badge cannot be granted client-side (server-derived
  from photoVerifiedAt + faceBadgeSuspendedAt only).

## Risk model (risk-engine.ts)

```
composite = trustEngine.riskScore        (device reuse, velocity, IP/VPN/Tor
                                          intel, email reuse, reports, bans,
                                          violations, scam behaviour, account
                                          age/profile signals - existing)
          + faceSignals                  (identity state, face decision,
                                          duplicate class, reference lifecycle,
                                          manipulation flags, appeal denials)

band: LOW < RISK_MEDIUM_AT(25) <= MEDIUM < RISK_HIGH_AT(50) <= HIGH
      < RISK_CRITICAL_AT(75) <= CRITICAL
```

Consumption rules:

- CRITICAL blocks auto-verification (manual review), never auto-rejects.
- Only LIKELY_IMPERSONATION (duplicate classification) may suspend the
  badge automatically; every other adverse signal routes to humans.
- Output is a band + normalized signal names; raw vendor values never
  leave the engine (tested).
- Every weight/threshold is env-configurable (see runbook table).
