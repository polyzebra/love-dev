# L1 - Tirvea Legal Architecture (Master Blueprint)

Single source of truth for every legal document, footer link, consent flow,
policy version, audit log, and compliance requirement. **Architecture only - no
legal text is drafted here.** All legal copy is drafted in later phases and must
be reviewed by qualified counsel before production.

## Entity & brand (invariant)

| | |
|---|---|
| Contracting legal entity / data controller | **WiseWave Limited** |
| Company number (CRO, Ireland) | 762171 |
| Registered office | 39 Cooley Park, Dundalk, Co. Louth, A91 AP2V, Ireland |
| Contact | info@tirvea.com |
| Brand / platform name | **Tirvea** (brand only - never a legal entity) |
| Forbidden strings | ~~Tirvea Ltd~~, ~~Tirvea Limited~~ |
| Initial jurisdictions | Ireland + United Kingdom |

---

## 1. Current architecture (Task 1 - audit)

**Existing `/legal/*` (19):** terms, privacy, cookies, community-guidelines,
acceptable-use, refund-policy, subscription-terms, identity-verification,
photo-verification, biometric-data, ai-moderation, security, child-safety,
data-retention, transparency, compliance, law-enforcement, copyright,
vulnerability-disclosure.
**Marketing:** /about, /careers, /blog, /press, /pricing, /safety,
/safety/face-check, /help/photo-verification.
**In-app:** /settings/{privacy, community-guidelines, subscription, account,
notifications, support}.
**Consent infra:** `src/lib/auth/consent.ts` (`CURRENT_VERSIONS` for
terms/privacy/community, `needsReacceptance()`, `recordConsent()` with audit
metadata), `gate.ts`; biometric `BIOMETRIC_CONSENT_VERSION="2026-07-bio-v1"` +
`/api/verification/consent/withdraw`; appeals at `/account/appeals`,
`/admin/appeals`, `/api/appeals`.

**Findings**
- ✅ Entity correct everywhere (0 `Tirvea Ltd/Limited`); footer links resolve.
- ❌ **No `/legal` hub** (Legal Centre index).
- ❌ Missing dedicated docs: **Trust & Safety Policy** (currently = Safety
  Centre), **Appeals Policy**, **Account Suspension Policy**, **Account Deletion
  Policy**, **GDPR Rights**, **Cookie Preferences** (interactive), **Status
  Page**, **Contact** (only mailto/About today).
- ⚠️ Duplication risk: biometric content spans `biometric-data` +
  `photo-verification`; deletion content spans `data-retention` + settings;
  copyright vs DMCA overlap. Needs canonical-owner rules (§6).
- ⚠️ Version model covers terms/privacy/community + biometric only - **no
  per-document version/effective-date/revision-history registry**.

---

## 2. Target architecture

Three tiers, one source of truth:
1. **Legal Centre** (`/legal/*`, public) - canonical documents.
2. **In-app mirrors** (`/settings/*`) - link to the canonical `/legal/*`; never
   fork the text.
3. **Operational surfaces** - consent capture (signup, checkout, verification),
   audit log (`ConsentEvent`/`VerificationAuditEvent`), external status page.

Principles: one canonical URL per concept; in-app never duplicates copy (links
out); every consequential action maps to a versioned consent + an audit event;
every document carries version + effective date + revision history.

---

## 3. Legal Centre (Task 2 - every page)

| # | Document | URL | Status |
|---|---|---|---|
| 1 | Legal Centre (index/hub) | `/legal` | **NEW** |
| 2 | Terms of Service | `/legal/terms` | exists |
| 3 | Privacy Policy | `/legal/privacy` | exists |
| 4 | Cookie Policy | `/legal/cookies` | exists |
| 5 | Cookie Preferences | `/legal/cookie-preferences` | **NEW** (interactive) |
| 6 | Community Guidelines | `/legal/community-guidelines` | exists |
| 7 | Acceptable Use Policy | `/legal/acceptable-use` | exists |
| 8 | Trust & Safety Policy | `/legal/trust-safety` | **NEW** (Safety Centre stays at `/safety`) |
| 9 | Safety Centre | `/safety` | exists (product hub) |
| 10 | Refund Policy | `/legal/refund-policy` | exists |
| 11 | Subscription Terms | `/legal/subscription-terms` | exists |
| 12 | Law Enforcement Guidelines | `/legal/law-enforcement` | exists |
| 13 | Copyright Policy | `/legal/copyright` | exists |
| 14 | DMCA / Copyright Complaints | `/legal/copyright#complaints` | anchor of #13 (no separate page) |
| 15 | AI Moderation Policy | `/legal/ai-moderation` | exists |
| 16 | Biometric Information Policy | `/legal/biometric-data` | exists (canonical for biometrics) |
| 17 | Identity Verification Policy | `/legal/identity-verification` | exists |
| 18 | Photo Verification Policy | `/legal/photo-verification` | exists |
| 19 | Data Retention Policy | `/legal/data-retention` | exists |
| 20 | GDPR Rights | `/legal/gdpr` | **NEW** |
| 21 | Transparency Report Policy | `/legal/transparency` | exists |
| 22 | Child Safety Policy | `/legal/child-safety` | exists |
| 23 | Security Policy | `/legal/security` | exists |
| 24 | Vulnerability Disclosure Policy | `/legal/vulnerability-disclosure` | exists |
| 25 | Compliance Statement | `/legal/compliance` | exists |
| 26 | Appeals Policy | `/legal/appeals` | **NEW** |
| 27 | Account Suspension Policy | `/legal/account-suspension` | **NEW** |
| 28 | Account Deletion Policy | `/legal/account-deletion` | **NEW** |
| 29 | About Tirvea | `/about` | exists |
| 30 | Contact | `/contact` | **NEW** (page; currently mailto/About) |
| 31 | Status Page | `https://status.tirvea.com` | **NEW** (external, operator-hosted) |

Net new: **`/legal` hub, cookie-preferences, trust-safety, gdpr, appeals,
account-suspension, account-deletion, contact, status (external)**.

---

## 4. Footer architecture (Task 4)

Same 4 groups across breakpoints; content identical (no hidden links). Desktop
= static 5-column grid; tablet = 2-3 columns; mobile = collapsible sections.

| Group | Links |
|---|---|
| **Product** | Safety Centre · Create Account · Sign In · Help |
| **Legal** | Terms · Privacy · Cookie Policy · Cookie Preferences · Refund Policy · Subscription Terms |
| **Safety & Compliance** | Community Guidelines · Trust & Safety · Identity Verification · Photo Verification · Biometric Information · AI Moderation · Security · Child Safety · Data Retention · GDPR Rights · Transparency · Compliance · Law Enforcement · Copyright · Appeals · Vulnerability Disclosure |
| **Company** | About · Contact · Careers · Blog · Press · Status |

Bottom bar: `© <year> WiseWave Limited. All rights reserved.` (full registered
details live on Terms/Privacy/Compliance, not the footer - per product decision).
Responsive: `grid-cols-1` (mobile accordion) → `md:` 2-3 cols → `lg:` 5-col
static. All links server-rendered (SEO); zero client JS.

---

## 5. URL structure (Task 3)

Convention: `/legal/<kebab-case-noun>`; hub at `/legal`; product hubs at top
level (`/safety`, `/about`, `/contact`); in-app mirrors under `/settings/*`
linking to `/legal/*`; status external. Never rename a published URL - add a
redirect if a concept moves. Anchors for sub-topics (e.g.
`/legal/copyright#complaints`, `/legal/gdpr#dsar`).

---

## 6. Consent architecture (Task 5)

| Consent | Trigger | Required? | Versioned key | Re-consent | Audit event | Withdrawal |
|---|---|---|---|---|---|---|
| Terms of Service | Signup | Required | `CURRENT_VERSIONS.terms` | on version bump (gate) | `ConsentEvent(terms)` | account deletion |
| Privacy notice | Signup | Required (transparency, not "consent") | `CURRENT_VERSIONS.privacy` | on bump | `ConsentEvent(privacy)` | n/a (info duty) |
| Community Guidelines | Signup | Required | `CURRENT_VERSIONS.community` | on bump | `ConsentEvent(community)` | account deletion |
| Age (18+) | Signup | Required | `ageConfirmedAt` | - | consent metadata | - |
| Login | Login | none (auth only) | - | - | auth audit | - |
| Subscription / billing | Checkout | Required (contract) | plan + price acceptance | on price change (notice) | Stripe + billing audit | cancel |
| Digital-content immediate access | Checkout | Optional (waives 14-day withdrawal) | checkout flag | per purchase | billing audit | refund window |
| Identity verification | Verify flow | Optional | provider session | per session | `VerificationAuditEvent` | n/a (outcome only) |
| Biometric processing (photo/liveness) | Photo-verify | **Explicit opt-in (GDPR Art. 9)** | `BIOMETRIC_CONSENT_VERSION` | on bump | `VerificationAuditEvent` + `consentAt` | `/api/verification/consent/withdraw` → deletes reference |
| AI processing (moderation) | Upload (notice) | Legitimate interest + notice | AI Moderation policy version | on material change | moderation audit | n/a |
| Cookies (non-essential) | First visit | Consent (opt-in) | cookie-consent version | on category change | cookie-consent log | Cookie Preferences |
| Marketing | Settings/opt-in | Optional (consent) | marketing flag | - | notification prefs | unsubscribe |
| Appeals | Appeal submit | Implicit (process) | - | - | appeal audit | - |
| Account deletion | Settings | Explicit action | deletion request | - | account audit | - |

Rules: separate, unbundled consent for each Art. 9 (biometric) and cookie
category; explicit opt-in for biometrics + non-essential cookies; withdrawal as
easy as giving; every state change writes an audit row (who/when/version).

---

## 7. Document dependency map (Task 6)

- **Root:** Terms of Service (parent contract) → references Privacy, Community
  Guidelines, Acceptable Use, Subscription Terms, Refund.
- **Privacy Policy (controller hub)** → children: Cookie, Data Retention, GDPR
  Rights, Identity Verification, Photo Verification, Biometric Information, AI
  Moderation, Law Enforcement, Transparency. Shared definitions live here
  (controller, processor, personal data, special-category data).
- **Community Guidelines** → Acceptable Use → Trust & Safety Policy → {Appeals,
  Account Suspension, Child Safety, AI Moderation, Transparency}.
- **Biometric Information Policy = canonical** for biometrics; Photo/Identity
  Verification reference it (no duplicated biometric text).
- **Copyright Policy** owns DMCA/complaints (anchor, not a 2nd page).
- **Account Deletion** references Data Retention; **Account Suspension**
  references Community Guidelines + Appeals.
- **Compliance Statement** = umbrella that cross-links all; owns no primary
  obligation text (pointer doc).
- Shared-definitions module (single glossary) referenced by all → avoids
  duplicated legal language.

---

## 8. Versioning (Task 7)

Per-document registry (proposed `legal_documents` config / DB table):
`slug, title, version (semver or date), effectiveDate, lastUpdated,
revisionHistory[], consentVersionKey (nullable), requiresReconsent (bool)`.

- **Policy version** ≠ **consent version.** Consent versions
  (`CURRENT_VERSIONS.{terms,privacy,community}`, `BIOMETRIC_CONSENT_VERSION`,
  cookie/marketing) gate re-acceptance; policy versions track document history.
- **Effective date** shown on-page; **Last updated** on-page; **revision
  history** appended, never rewritten.
- **Migration:** material change → bump the relevant `CURRENT_VERSIONS` entry →
  `needsReacceptance()` forces re-consent at the next gate; acceptance writes a
  `ConsentEvent` with the new version (audit). Non-material edits bump
  lastUpdated only (no re-consent).
- **Acceptance audit:** every acceptance/withdrawal is an immutable event
  (user, timestamp, version, IP-hash) - already implemented for signup consent;
  extend to cookie/biometric/marketing.

---

## 9. Compliance map (Task 8)

| Regime | Anchored by |
|---|---|
| **GDPR** (controller, legal bases, rights, retention, transfers) | Privacy, GDPR Rights, Data Retention, Cookie, Biometric |
| **Irish DPA 2018 / DPC** | Privacy, Compliance (DPC as supervisory authority) |
| **EU DSA** (notice-action, statement of reasons, internal complaints, transparency, illegal-content, LE) | Trust & Safety, Transparency, Appeals, Law Enforcement, Community Guidelines |
| **UK GDPR (future-ready)** | Privacy + GDPR Rights (add ICO + UK representative when UK live) |
| **Consumer protection (EU/IE)** | Subscription Terms, Refund (auto-renewal, cancellation, 14-day withdrawal) |
| **Stripe requirements** | Subscription Terms + Refund (billing); Identity Verification (Stripe Identity) |
| **AWS biometric processing** | Biometric Information + Photo Verification (liveness/Rekognition, DPIA, no image retention, opaque FaceIds); DPA with AWS |
| **Security disclosures** | Security Policy + Vulnerability Disclosure |
| **Child safety** | Child Safety (18+, CSAM zero-tolerance, reporting) |
| **IP** | Copyright / DMCA |

Cross-cutting: DPIA reference (`DPIA-FACE-VERIFICATION.md`); processor register
(Task L4) listing Stripe, AWS, Supabase, Resend, Twilio, Upstash + their DPAs.

---

## 10. Document ownership (Task 9)

| Doc(s) | Owner | Audience | Review cadence | Legal dep | Eng dep |
|---|---|---|---|---|---|
| Terms, Subscription, Refund | Legal Counsel | users | 12 mo / on change | consumer law | billing/Stripe |
| Privacy, GDPR Rights, Cookie, Data Retention | Privacy Counsel / DPO | users, DPC | 12 mo | GDPR/DPA | data map, cookies |
| Biometric, Identity/Photo Verification | Privacy Counsel + T&S | users, DPC | 6 mo (higher-risk) | Art. 9, DPIA | verification stack |
| Community, Acceptable Use, Trust & Safety, Appeals, Suspension, Child Safety, AI Moderation, Transparency | Trust & Safety Lead | users, regulators | 6-12 mo | DSA | moderation/appeals |
| Security, Vulnerability Disclosure | Security Lead | researchers | 12 mo | - | infra |
| Law Enforcement | Legal Counsel | LE | 12 mo | MLAT/local law | - |
| Compliance, Copyright, About, Contact | Legal / Company | public | 12 mo | mixed | - |
| Status | Ops | users | live | - | monitoring |

---

## 11. Gap analysis (Task 10)

- **Missing pages:** `/legal` hub, cookie-preferences, trust-safety, gdpr,
  appeals, account-suspension, account-deletion, contact, external status.
- **Duplicate concepts to canonicalise:** biometrics → Biometric Information
  (others reference); deletion → Account Deletion (Data Retention references);
  DMCA → Copyright anchor.
- **Missing disclosures:** dedicated GDPR-rights + DSAR flow page; processor
  register; explicit AI-moderation legal-basis notice at upload.
- **Missing consent:** first-class **cookie-consent** capture + preferences UI;
  **marketing** consent record; ensure **biometric** opt-in is unbundled (it is)
  and logged as its own event.
- **Missing footer links:** cookie-preferences, gdpr, appeals, trust-safety,
  contact, status (add in L11 footer refresh).
- **Missing audit logs:** cookie + marketing acceptance events (extend
  `ConsentEvent`); currently only terms/privacy/community + biometric are logged.
- **Missing version control:** per-document version registry + on-page
  effective/last-updated/revision history (only consent versions exist today).
- **Missing compliance items:** DSA statement-of-reasons record schema; UK
  representative + ICO (when UK live); DPIA published reference; processor DPAs
  register.

---

## Implementation roadmap (prioritised)

| Phase | Scope | Delivers |
|---|---|---|
| **L2 - Core Legal Documents** | Terms, Privacy, Cookie, Community Guidelines, Acceptable Use, `/legal` hub | contract + transparency baseline |
| **L3 - Trust & Safety** | Trust & Safety, Appeals, Account Suspension, Child Safety, AI Moderation, Transparency, Law Enforcement | DSA + safety framework |
| **L4 - Privacy & GDPR** | GDPR Rights, Data Retention, Account Deletion, Cookie Preferences, DSAR flow, processor register + DPAs | data-subject rights + records |
| **L5 - Subscriptions** | Subscription Terms, Refund, cooling-off/immediate-access consent, Stripe alignment | consumer-law compliance |
| **L6 - Verification & Biometrics** | Biometric Information (canonical), Identity Verification, Photo Verification, liveness disclosures, biometric consent/withdrawal audit, DPIA link | Art. 9 + AWS compliance |
| **L7 - Security & Compliance** | Security, Vulnerability Disclosure, Compliance Statement, Copyright/DMCA | security + IP + umbrella |
| **L8 - Final Legal Audit** | links, entity, versions, consent audit trail, footer, sitemap/SEO, language, code↔doc consistency, **counsel sign-off** | production readiness |

**Cross-phase invariants:** every document carries the entity block (WiseWave
Limited); every material change bumps a consent version + writes an audit event;
in-app never forks legal copy (links to `/legal/*`); all legal text is
counsel-reviewed before production.
