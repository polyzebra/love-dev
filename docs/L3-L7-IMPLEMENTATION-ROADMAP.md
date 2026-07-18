# Tirvea - Master Legal Implementation Roadmap (L3-L7)

**PLANNING ARTIFACT - execution plan for the remaining legal library. No legal text is drafted here.**

> Operator / contracting entity throughout: **WiseWave Limited** (Company Number 762171, 39 Cooley Park, Dundalk, Co. Louth, A91 AP2V, Ireland, info@tirvea.com). "Tirvea" is the brand only. "Tirvea Ltd" / "Tirvea Limited" must never appear.

---

## 0. Status correction & baseline

The Legal Publishing System (L2.7) renders any `/legal/<slug>` from a `docs/` master with frontmatter. Six documents are already mastered + migrated:

- **Completed & migrated:** Terms (L2.2), Privacy (L2.3), Cookies (L2.4), Community Guidelines (L2.5), Acceptable Use (L2.6), **Trust & Safety (L3.1)**.

**Correction to the brief's list:** *Trust & Safety Policy already has its master (`docs/L3.1-TRUST-AND-SAFETY-POLICY-DRAFT.md`) and is migrated.* It is not a drafting item - it only needs counsel sign-off + a `status: published` flip. That leaves **20 documents to draft** (not 21).

**Current state of the 20 remaining (audited, not from memory):**

| # | Document | Slug | Current impl | Lines | Counsel notes |
|---|---|---|---|---|---|
| 1 | Child Safety Policy | child-safety | Hardcoded JSX | 50 | - |
| 2 | Appeals Policy | appeals | Placeholder | 20 | - |
| 3 | Account Suspension Policy | account-suspension | Placeholder | 19 | - |
| 4 | AI Moderation Policy | ai-moderation | Hardcoded JSX | 51 | - |
| 5 | Data Retention Policy | data-retention | Hardcoded JSX | 57 | - |
| 6 | GDPR Rights | gdpr | Placeholder | 20 | - |
| 7 | Account Deletion Policy | account-deletion | Hardcoded JSX | 20 | - |
| 8 | Cookie Preferences | cookie-preferences | Placeholder | 19 | - |
| 9 | Biometric Information Policy | biometric-data | Placeholder | 78 | **6 (DPIA/counsel)** |
| 10 | Photo Verification Policy | photo-verification | Hardcoded JSX | 48 | - |
| 11 | Identity Verification Policy | identity-verification | Hardcoded JSX | 52 | - |
| 12 | Subscription Terms | subscription-terms | Hardcoded JSX | 66 | - |
| 13 | Refund Policy | refund-policy | Hardcoded JSX | 52 | - |
| 14 | Security Policy | security | Hardcoded JSX | 41 | - |
| 15 | Vulnerability Disclosure Policy | vulnerability-disclosure | Hardcoded JSX | 45 | - |
| 16 | Law Enforcement Guidelines | law-enforcement | Hardcoded JSX | 62 | - |
| 17 | Transparency Report | transparency | Hardcoded JSX | 54 | - |
| 18 | Copyright Policy | copyright | Hardcoded JSX | 52 | - |
| 19 | Compliance Statement | compliance | Hardcoded JSX | 54 | - |
| 20 | Legal Contact | contact | Hardcoded JSX | 26 | - |

None of the 20 has a `docs/` master; all legal text lives only in JSX (to be replaced, never copied). The **Biometric Information** placeholder already carries counsel/DPIA flags - its master must reconcile with `docs/DPIA-FACE-VERIFICATION.md`.

---

## 1. Document inventory (Task 1)

Per-document: purpose · owner · engineering owner · required cross-references (canonical targets it must reference, never duplicate).

| Document | Legal owner | Eng owner | Required cross-references (canonical) |
|---|---|---|---|
| Child Safety Policy | Trust & Safety Lead + Child-Safety Specialist | T&S eng (verify age-assurance claims) | community-guidelines, trust-safety, law-enforcement, privacy |
| Appeals Policy | Trust & Safety Lead | T&S eng (verify appeals service) | trust-safety, account-suspension, transparency, community-guidelines |
| Account Suspension Policy | Trust & Safety Lead | T&S eng (verify AccountStatus ladder) | community-guidelines, appeals, trust-safety, account-deletion |
| AI Moderation Policy | Trust & Safety Lead | T&S eng (verify moderation/risk engine) | community-guidelines, transparency, appeals, privacy, trust-safety |
| Data Retention Policy | Privacy Counsel / DPO | Platform eng (verify retention jobs) | privacy, account-deletion, biometric-data |
| GDPR Rights | Privacy Counsel / DPO | Platform eng (verify DSAR flow) | privacy, data-retention, account-deletion, gdpr |
| Account Deletion Policy | Privacy Counsel / DPO | Platform eng (verify deletion job) | data-retention, gdpr, privacy, biometric-data |
| Cookie Preferences | Privacy Counsel / DPO | Web eng (verify consent tool) | cookies, privacy, cookie-preferences |
| Biometric Information Policy | Privacy Counsel + T&S | Face-verification eng | photo-verification, privacy, data-retention |
| Photo Verification Policy | Privacy Counsel + T&S | Face-verification eng | biometric-data, identity-verification, acceptable-use |
| Identity Verification Policy | Privacy Counsel + T&S | Verification eng | photo-verification, privacy, trust-safety |
| Subscription Terms | Legal Counsel (commercial) | Billing eng | refund-policy, terms, privacy |
| Refund Policy | Legal Counsel (commercial) | Billing eng | subscription-terms, terms |
| Security Policy | Security Lead | Security eng | vulnerability-disclosure, privacy, acceptable-use |
| Vulnerability Disclosure Policy | Security Lead | Security eng | security, acceptable-use |
| Law Enforcement Guidelines | Legal Counsel | T&S eng | privacy, data-retention, child-safety, transparency |
| Transparency Report | Trust & Safety Lead | T&S eng (metrics) | community-guidelines, ai-moderation, appeals |
| Copyright Policy | Legal Counsel | Web eng | acceptable-use, terms |
| Compliance Statement | Legal Counsel | - | privacy, transparency, child-safety, subscription-terms, refund-policy, law-enforcement |
| Legal Contact | Legal Counsel | Web eng | about, compliance, law-enforcement, copyright, vulnerability-disclosure |

---

## 2. Dependency graph (Task 2)

Edges are **content dependencies** - the canonical-owner document that another must reference rather than restate. (Routing is not a dependency: all `/legal/*` routes already resolve to placeholders, so a doc may reference an un-drafted target without breaking; the ordering is about drafting canonical definitions first.)

**Canonical owners (draft first within their domain):**
- **Data Retention** → underpins Account Deletion, Biometric Information, GDPR Rights, Law Enforcement.
- **Child Safety** → underpins Law Enforcement, Compliance, Transparency (already referenced by published Trust & Safety / Community / AUP).
- **Biometric Information** → underpins Photo Verification (and Privacy already references it).
- **Appeals** → underpins Account Suspension, AI Moderation, Transparency.
- **Subscription Terms** → underpins Refund Policy.
- **Security** → underpins Vulnerability Disclosure.
- **Compliance** = terminal aggregator → depends on Child Safety, Law Enforcement, Privacy, Subscription, Refund, Transparency → **draft last**.

**Topological tiers:**
```
Tier 0 (done):  Terms · Privacy · Cookies · Community · AUP · Trust & Safety
Tier 1 (canon): Child Safety · Data Retention · Appeals · Security · Subscription Terms · Biometric Information
Tier 2:         AI Moderation · Account Suspension · GDPR Rights · Account Deletion · Cookie Preferences ·
                Vulnerability Disclosure · Refund Policy · Photo Verification · Identity Verification ·
                Law Enforcement · Transparency · Copyright · Legal Contact
Tier 3 (aggr):  Compliance Statement
```

---

## 3. Per-document specification (Task 3)

Purpose / scope condensed; section-count and complexity estimated from the comparable completed drafts (Terms 52, Privacy 52, Community 50, T&S 40, Cookies 31).

| Document | Purpose (one line) | Est. sections | Review complexity |
|---|---|---|---|
| Child Safety Policy | Zero-tolerance framework: age assurance, CSAM, grooming, mandatory reporting | ~30 | **Very High** |
| Appeals Policy | DSA-aligned internal complaint-handling + out-of-court dispute route | ~22 | High |
| Account Suspension Policy | Grounds, notice, duration, states for restriction/suspension/removal | ~24 | Medium-High |
| AI Moderation Policy | Automated-assist model, human oversight, Art. 22 / AI Act | ~26 | High |
| Data Retention Policy | Retention periods & criteria per data category; deletion schedule | ~28 | High |
| GDPR Rights | DSAR mechanics, all data-subject rights, SA complaint | ~26 | High |
| Account Deletion Policy | Deletion flow, grace window, post-deletion holds | ~22 | Medium |
| Cookie Preferences | Consent categories + management (forward-looking to consent tool) | ~16 | Medium |
| Biometric Information Policy | Art. 9 explicit-consent biometrics, opaque FaceId, DPIA, BIPA-ready | ~34 | **Very High** |
| Photo Verification Policy | Liveness + comparison, consent, retention, spoofing | ~30 | High |
| Identity Verification Policy | Stripe Identity, document handling, outcomes | ~28 | High |
| Subscription Terms | Plans, renewal, cancellation, cooling-off | ~30 | High (commercial) |
| Refund Policy | Withdrawal right, digital-content exception, refund mechanics | ~24 | High (commercial) |
| Security Policy | Technical & organisational controls, incident/breach response | ~28 | Medium-High |
| Vulnerability Disclosure Policy | Scope, safe harbour, reporting process | ~22 | Medium |
| Law Enforcement Guidelines | Request handling, preservation, emergency disclosure | ~26 | High |
| Transparency Report | Moderation/enforcement reporting, DSA transparency | ~24 | Medium-High |
| Copyright Policy | IP respect, notice-and-action, DMCA + DSA | ~24 | Medium-High |
| Compliance Statement | Operating entity + regimes umbrella; pointers only | ~26 | High (aggregator) |
| Legal Contact | Contact routing for legal/privacy/security/LE matters | ~12 | Low |

---

## 4. Publication order - phases L3-L7 (Task 4)

Ordered by dependency (canonical-first) and grouped by domain for reviewer batching; highest legal/reputational risk first.

- **Phase L3 - Child Safety & Enforcement** (highest risk; underpins the already-published Trust & Safety/Community set)
  1. Child Safety Policy → 2. Appeals Policy → 3. Account Suspension Policy → 4. AI Moderation Policy
- **Phase L4 - Privacy Operations** (Data Retention is a canonical dependency for L5 + Account Deletion)
  5. Data Retention Policy → 6. GDPR Rights → 7. Account Deletion Policy → 8. Cookie Preferences
- **Phase L5 - Verification & Biometrics** (needs Data Retention from L4)
  9. Biometric Information Policy → 10. Photo Verification Policy → 11. Identity Verification Policy
- **Phase L6 - Commercial** (independent; parallelisable with L3-L5)
  12. Subscription Terms → 13. Refund Policy
- **Phase L7 - Regulation, Security & Company** (Compliance aggregator last)
  14. Security Policy → 15. Vulnerability Disclosure Policy → 16. Law Enforcement Guidelines → 17. Transparency Report → 18. Copyright Policy → 19. Compliance Statement → 20. Legal Contact

---

## 5. Review requirements matrix (Task 5)

✓ = required · ~ = likely / partial · - = not applicable.

| Document | DSA | GDPR | Security | Commercial | Child Safety | External counsel |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Child Safety Policy | ✓ | ✓ | - | - | ✓ | ✓ |
| Appeals Policy | ✓ | ~ | - | - | - | ~ |
| Account Suspension Policy | ✓ | ~ | - | - | - | - |
| AI Moderation Policy | ✓ | ✓ | - | - | ~ | ~ |
| Data Retention Policy | - | ✓ | ~ | ~ | - | ~ |
| GDPR Rights | - | ✓ | - | - | - | ✓ |
| Account Deletion Policy | - | ✓ | ~ | - | - | - |
| Cookie Preferences | - | ✓ | - | - | - | ~ |
| Biometric Information Policy | - | ✓ | ✓ | - | - | ✓ |
| Photo Verification Policy | - | ✓ | ✓ | - | - | ~ |
| Identity Verification Policy | - | ✓ | ✓ | - | ~ | ~ |
| Subscription Terms | - | - | - | ✓ | - | ✓ |
| Refund Policy | - | - | - | ✓ | - | ✓ |
| Security Policy | - | ~ | ✓ | - | - | - |
| Vulnerability Disclosure Policy | - | - | ✓ | - | - | ~ |
| Law Enforcement Guidelines | ✓ | ✓ | ~ | - | ✓ | ✓ |
| Transparency Report | ✓ | ~ | - | - | - | ~ |
| Copyright Policy | ✓ | - | - | ~ | - | ~ |
| Compliance Statement | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Legal Contact | ~ | ~ | - | - | - | - |

---

## 6. Migration plan (Task 6)

Every document follows the identical L2.7 mechanic (proven on the first six):

1. **Author** `docs/<code>-<NAME>-DRAFT.md` with the legal body under a `## 3. Output - Complete <Doc>` heading (the loader extracts only that region; scaffolding stays internal).
2. **Frontmatter** at top: `title, slug, category, version, effectiveDate (""), lastUpdated, status: draft, owner, requiresCounselReview: true, requiresReConsent, relatedPolicies, description` (+ `consentVersion` if consent-bearing).
3. **Register** the slug: add to `src/lib/legal/doc-slugs.ts` (`LEGAL_DOC_SLUGS`) and `src/lib/legal/loader.ts` (`LEGAL_DOC_FILES`).
4. **Thin-wrapper** the page: replace JSX with `generateMetadata` + `<LegalDocument slug="…" />` (≈12 lines).
5. **Remove** all hardcoded legal text - single source in `docs/`.
6. **Reconcile registry** entry (status/version/owner) so the hub is honest.
7. **Verify** (automated): `tsc` + `build`; rendered section count == master; **0 scaffolding leaks**; **0** "Tirvea Ltd/Limited"; cross-refs resolve; SEO/robots/JSON-LD; sitemap consistency.
8. **On counsel sign-off:** set `effectiveDate`, flip `status: published`, `requiresCounselReview: false`; consent-bearing docs bump `CURRENT_VERSIONS` to trigger re-consent.

**Consent-versioned docs** (need `CURRENT_VERSIONS` wiring on publish): none of the 20 are new consent gates except **Cookie Preferences** (cookie consent version - currently declared in registry but not wired in `src/lib/auth/consent.ts`). Flag: wire the `cookies` consent key before Cookie Preferences goes live.

---

## 7. Implementation matrix (Task 7)

Effort: S ≤0.5d · M ~1d · L ~2d · XL ~3d+ (drafting + verification; excludes external-counsel wall-clock). Priority = P1 (do first) … P5.

| Document | Priority | Dependencies | Review owner | Engineering work | Publishing work | Est. effort | Publication blocker |
|---|:--:|---|---|---|---|:--:|---|
| Child Safety Policy | P1 | - (canonical) | T&S + Child-Safety + ext. counsel | Verify age-assurance claims | Migrate + register | XL | Mandatory-reporting bodies / hotline (NCMEC) confirmed |
| Appeals Policy | P1 | Trust & Safety | T&S + DSA counsel | Verify appeals service | Migrate + register | M | DSA Art. 20-21 ADR bodies |
| Account Suspension Policy | P1 | Community, Appeals | T&S + DSA counsel | Verify AccountStatus ladder | Migrate + register | M | - (aligns to code) |
| AI Moderation Policy | P1 | Appeals, Transparency | T&S + DSA/GDPR counsel | Verify moderation/risk engine | Migrate + register | L | Art. 22 / EU AI Act analysis |
| Data Retention Policy | P2 | - (canonical) | Privacy/DPO | Confirm retention jobs/periods | Migrate + register | L | Retention periods (DPIA) confirmed |
| GDPR Rights | P2 | Data Retention | Privacy/DPO + ext. counsel | Verify DSAR flow | Migrate + register | L | DPC details / SA one-stop-shop |
| Account Deletion Policy | P2 | Data Retention, GDPR | Privacy/DPO | Verify deletion job + grace | Migrate + register | M | Post-deletion hold periods |
| Cookie Preferences | P2 | Cookies | Privacy/DPO | Build consent tool + wire version | Migrate + register | M | Consent tool + `cookies` version wiring |
| Biometric Information Policy | P3 | Data Retention | Privacy + Security + ext. counsel | Reconcile with DPIA doc | Migrate + register | XL | DPIA sign-off + BIPA (US) counsel |
| Photo Verification Policy | P3 | Biometric | Privacy + Security | Verify liveness/Rekognition flow | Migrate + register | L | Aligns with Biometric sign-off |
| Identity Verification Policy | P3 | Photo | Privacy + Security | Verify Stripe Identity flow | Migrate + register | L | - |
| Subscription Terms | P4 | - (canonical) | Commercial + ext. counsel | Verify billing/renewal | Migrate + register | L | Consumer-law + VAT/OSS counsel |
| Refund Policy | P4 | Subscription | Commercial + ext. counsel | Verify refund flow | Migrate + register | M | Withdrawal-right / digital-content exception |
| Security Policy | P5 | - (canonical) | Security | Confirm controls claims | Migrate + register | L | - |
| Vulnerability Disclosure Policy | P5 | Security | Security | Confirm intake | Migrate + register | M | Safe-harbour vs computer-misuse law |
| Law Enforcement Guidelines | P5 | Privacy, Data Retention, Child Safety | Legal + ext. counsel | Verify request handling | Migrate + register | L | Disclosure thresholds per jurisdiction |
| Transparency Report | P5 | AI Moderation, Appeals | T&S + DSA counsel | Wire metrics source | Migrate + register | L | DSA reporting scope + real metrics |
| Copyright Policy | P5 | AUP | Legal + DSA counsel | Verify notice intake | Migrate + register | M | DMCA + DSA notice-and-action |
| Compliance Statement | P5 | (aggregator: many) | Legal (all specialists) | - | Migrate + register | L | All referenced docs signed off |
| Legal Contact | P5 | Compliance | Legal | Confirm routes | Migrate + register | S | DSA single-point-of-contact designation |

---

## 8. Workflows

### Review workflow (per document)
```
Draft master (docs/) ─▶ Automated internal QA ─▶ Specialist review ─▶ External counsel ─▶ Sign-off ─▶ Publish
                          (cross-ref resolve,      (DSA / GDPR /        (where flagged in    (set effective   (flip status,
                           entity invariant,        security / child-     §5 matrix)           date, cap/       re-consent if
                           section count, no         safety / commercial)                      figures)         consent-bearing)
                           scaffolding leak)
```
- **Automated QA** is the same gate used on L2.2-L3.1 and is a hard pre-condition for human review.
- A document cannot flip to `status: published` until its **Publication blocker** (§7) is cleared.

### Publication workflow (per document)
Identical to §6 steps 1-8. Publishing is decoupled from approval: a document can be **migrated (draft, noindex)** immediately - rendering through the system with a Draft/Review badge - and later **published** by a one-line frontmatter flip once counsel signs off. This is the L2.7 design and requires no further engineering per document.

### Cross-cutting blockers to resolve once (benefit multiple docs)
1. **Trusted-flagger process (DSA Art. 22)** - established operationally in Trust & Safety §32; formalise criteria (affects Appeals, AI Moderation, Transparency, Copyright).
2. **Mandatory-reporting bodies / hotlines** - (Child Safety, Law Enforcement).
3. **DSA single point(s) of contact** - (Trust & Safety, Transparency, Legal Contact, Compliance).
4. **DPIA sign-off + retention periods** - (Biometric, Photo, Data Retention, Account Deletion).
5. **Cookie consent tool + version wiring** - (Cookie Preferences).
6. **Consumer-law + VAT counsel** - (Subscription, Refund).

---

## 9. Final phased roadmap (summary)

| Phase | Theme | Documents (in order) | Count | Dominant review | Gating dependency |
|---|---|---|---|---|---|
| **L3** | Child Safety & Enforcement | Child Safety · Appeals · Account Suspension · AI Moderation | 4 | DSA + Child Safety | none (canonical) |
| **L4** | Privacy Operations | Data Retention · GDPR Rights · Account Deletion · Cookie Preferences | 4 | GDPR | Data Retention first |
| **L5** | Verification & Biometrics | Biometric Information · Photo Verification · Identity Verification | 3 | GDPR Art. 9 + Security | needs L4 Data Retention |
| **L6** | Commercial | Subscription Terms · Refund Policy | 2 | Commercial / consumer | parallelisable |
| **L7** | Regulation, Security & Company | Security · Vulnerability Disclosure · Law Enforcement · Transparency · Copyright · Compliance · Legal Contact | 7 | Security + DSA | Compliance last (aggregator) |

**Totals:** 20 documents to draft across 5 phases (Trust & Safety already complete). Recommended execution: draft + auto-verify + migrate each document as a **draft (noindex)** in phase order, accumulating the library behind badges; flip to **published** per document as counsel clears each Publication blocker. Suggested next action: **begin Phase L3 with the Child Safety Policy** (highest risk, canonical, no upstream dependency).

---

*This roadmap is the master execution plan for the remaining 20 legal documents. No document text has been drafted. Nothing committed or pushed.*
