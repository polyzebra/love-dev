# Internal Rehearsal — Face Verification

A controlled, internal-only rehearsal of the face-verification layer. This
document is the **checklist**; the tooling enforces the gates and can dry-run
the journey. Nothing here enables production. The rehearsal is refused unless
every hard gate passes.

- **Gate check + plan:** `npm run face:rehearsal`
- **Headless dry-run (non-prod, mock provider):**
  `npm run face:rehearsal -- --simulate --subject <id> --cover-subject <id>`
- **Admin status view:** `GET /api/admin/face-rehearsal` (permission `verifications:review`)
- **Cleanup:** `npm run face:rehearsal -- --cleanup --subject <id> --cover-subject <id>`
- **Preflight (run first):** `npm run face:preflight -- --require-legal`

The command exits `0` ready · `2` crash · `3` a gate is unmet (refused) ·
`4` a simulated step failed.

---

## Hard gates (all must pass before a rehearsal may run)

The rehearsal command **refuses to run** if any gate is unmet. Each is a
read-only check — no gate is set for you.

| #   | Gate                                                          | How it is satisfied                                                      |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | Counsel-approved legal version exists                         | `FACE_LEGAL_APPROVED_VERSIONS` lists at least one counsel-signed version |
| 2   | `FACE_LEGAL_APPROVAL_VERSION` supplied by an authorized human | env set **and** equal to a value in gate 1's list                        |
| 3   | AWS DPA confirmed                                             | `FACE_AWS_DPA_CONFIRMED=1` (set once the DPA is executed)                |
| 4   | Calibration report approved                                   | `FACE_CALIBRATION_APPROVED=1` **and** a threshold version stamped        |
| 5   | External alert channel active                                 | `ALERT_WEBHOOK_URL` (or an injected transport) configured                |
| 6   | `FACE_VERIFICATION_PERCENT = 0`                               | rehearsal admits via the internal allowlist only                         |
| 7   | Internal allowlist configured                                 | `FACE_INTERNAL_USER_ALLOWLIST` non-empty                                 |
| 8   | Emergency disable tested                                      | `FACE_EMERGENCY_DISABLE_TESTED=1` (verify the kill switch first)         |

> Gates 1–4 and 8 are human attestations recorded as env values. They exist so
> a rehearsal cannot begin from an unprepared or unapproved environment. They
> do **not** enable production — `FACE_MATCH_PROVIDER` and the runtime legal
> gate are still required for any real processing, and both stay unset in prod.

---

## Preflight verification

Before the rehearsal, run the non-destructive readiness check:

```
npm run face:preflight -- --require-legal
```

It proves credentials, region, collection, and runtime IAM with a single
read-only `ListFaces` — it never processes an image. A `FAIL` there blocks the
rehearsal. Then confirm all eight hard gates with `npm run face:rehearsal`.

---

## The required internal-only journey

Two **different, consenting, internal** subjects are used: the primary
`subject` and a `cover-subject` who stands in as an impostor cover. Both must
be on the internal allowlist.

| #   | Step                                         | Expected result                                                    |
| --- | -------------------------------------------- | ------------------------------------------------------------------ |
| 1   | Approved internal account                    | subject is on the internal allowlist                               |
| 2   | Explicit consent                             | biometric consent recorded (versioned)                             |
| 3   | Stripe identity verified                     | `photoVerifiedAt` set                                              |
| 4   | AWS reference enrolled                       | reference LINKED / ACTIVE (via liveness)                           |
| 5   | Same-person cover checked                    | cover auto-verifies                                                |
| 6   | Badge visible                                | `isPubliclyVerified` true                                          |
| 7   | Replacement cover (the cover-subject's face) | adverse outcome (rejected/suspended)                               |
| 8   | Badge suspended                              | badge hidden; not publicly verified                                |
| 9   | Same-person cover restored                   | badge **stays** suspended (no silent auto-restore)                 |
| 10  | Badge restored only through correct policy   | `restore_badge` admin action clears suspension                     |
| 11  | Consent withdrawn                            | consent cleared, badge hidden, `photoVerifiedAt` intact            |
| 12  | Reference deleted                            | no ACTIVE reference remains (idempotent)                           |
| 13  | Emergency disable tested                     | kill switch blocks admission and raises `emergency_disable_active` |
| 14  | No raw biometric identifiers exposed         | no FaceId / sessionId / reference id in any output                 |

**Headless dry-run** (`--simulate`) walks all 14 steps automatically against
the mock provider — the safe way to prove the tooling and every policy
transition without touching a real biometric. It refuses to run in production
and requires `FACE_MATCH_PROVIDER=mock`.

**Operator-led AWS rehearsal**: with the gates green, the browser-side steps
(liveness capture, cover photo swap) are performed by the internal subjects;
the server-side transitions and assertions above are the acceptance criteria.

---

## Cleanup procedure

Always run cleanup afterwards (it is idempotent and safe after a partial run):

```
npm run face:rehearsal -- --cleanup --subject <id> --cover-subject <id>
```

For each subject this: withdraws consent, deletes every reference (vendor +
local), clears the badge suspension and the `photoVerifiedAt` the rehearsal
set, and drops the verification job and any open liveness sessions. Confirm in
the admin status view that no residual state remains.

---

## Evidence template

Capture an evidence record with `--evidence <path>` on a simulate run, or fill
this template by hand for an operator-led rehearsal. **Never** paste a FaceId,
liveness sessionId, or any raw biometric identifier into evidence.

```json
{
  "kind": "face-rehearsal-evidence",
  "recordedAt": "<ISO-8601>",
  "environment": "<staging|internal>",
  "provider": "<mock|aws_rekognition_faces>",
  "operator": "<name/role of the human running the rehearsal>",
  "subjects": { "primary": "<internal-id>", "cover": "<internal-id>" },
  "gates": [
    { "id": "legal_version_recorded", "ok": true },
    { "id": "legal_version_supplied", "ok": true },
    { "id": "aws_dpa_confirmed", "ok": true },
    { "id": "calibration_approved", "ok": true },
    { "id": "alert_channel_active", "ok": true },
    { "id": "verification_percent_zero", "ok": true },
    { "id": "internal_allowlist_configured", "ok": true },
    { "id": "emergency_disable_tested", "ok": true }
  ],
  "steps": [
    { "step": 1, "id": "approved_internal_account", "status": "PASS", "note": "" }
    /* ... steps 2–14 ... */
  ],
  "ok": true,
  "biometricSafe": true,
  "cleanupConfirmed": true,
  "signoff": { "engineering": "", "legal": "", "date": "" }
}
```
