# Tirvea - Legal Authoring Style Standard

Canonical formatting rules for every Tirvea legal document and legal UI string. This standard is mandatory for all current and future legal masters (L3-L7 and beyond), for the prompts that generate them, and for any hardcoded legal copy. A regression guard (`tests/legal-typography.test.ts`, run by `npm test`) enforces the punctuation and section-reference rules automatically.

## 1. Punctuation

- Use only the ordinary ASCII hyphen: `-`.
- Never use the em dash character (Unicode U+2014).
- Never use the en dash character (Unicode U+2013).
- Where an em dash would previously have separated a clause, use a spaced hyphen instead.

Correct:

- WiseWave Limited - the Company
- Articles 20-23
- 2026-2027

## 2. Section references

Use the single section symbol `§`. Repeat it before every number, including on both ends of a range. Never double the section symbol.

- Single section: `§24`
- Range (repeat the symbol on both ends): `§24-§29`
- Subsection range: `§24.1-§24.4`
- Two sections: `§24 and §26`
- Three or more sections: `§24, §26 and §29` (comma-separated, with "and" before the final reference, no comma before "and")

Rules:

- Do not double the section symbol.
- Do not write a range with the symbol on only one end; always repeat it.
- Do not join a range with an en dash or em dash; use the ASCII hyphen.
- Bare numeric ranges that are not section references (for example, article ranges such as "Articles 20-23") take the ASCII hyphen and no section symbol.

## 3. Entity

- The contracting entity is always: WiseWave Limited.
- Company Number: 762171.
- Registered Office: 39 Cooley Park, Dundalk, Co. Louth, A91 AP2V, Ireland.
- Never write "Tirvea Ltd".
- Never write "Tirvea Limited".
- "Tirvea" is the brand and platform name only; it is never the legal entity.

## 4. Contact

- Use info@tirvea.com unless another address is explicitly approved and configured.

## 5. Cross-references

- Reference a related policy by its canonical path in backticks, for example `/legal/privacy`. The Legal Publishing System renders these as links automatically.
- Reference, never duplicate, definitions owned by another policy.

## 6. Enforcement

- The guard scans `docs/` legal masters, `src/app/(marketing)/legal`, `src/components/legal`, and `src/lib/legal`.
- It fails the build/test run on any em dash, en dash, doubled section symbol, or malformed section range, printing the file, line, offending text, and expected format.
- Every future L3-L7 legal-document prompt and generated master must comply with this standard before drafting begins.
