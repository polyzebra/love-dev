/**
 * L6.6 Phase M - Trust Contract governance. These guards FAIL CI if a future
 * change forks the verified-badge trust contract. There must FOREVER remain:
 *   - ONE public-badge resolver (the version-gate conjunction lives in exactly
 *     one file), and isPubliclyVerified delegates to it;
 *   - ONE gallery-version comparison (no page / API / component recomputes it);
 *   - ONE Trust Badge component (no hand-rolled blue check on member surfaces);
 *   - ONE canonical trust copy (no divergent / dishonest verification strings).
 * Pure source-contract; no DB. Run:  npx tsx tests/trust-contract-governance.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const read = (p: string) => readFileSync(p, "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (p.includes("/generated/")) continue; // Prisma client embeds the schema as a string
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** Strip comment lines/inline comments so guards match EXECUTABLE code only. */
function stripComments(src: string): string {
  return src
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

const RESOLVER = "src/lib/trust/verification-state-machine.ts";
const BADGE = "src/components/shared/verified-badge.tsx";

function main() {
  const files = walk("src");

  // ---- ONE resolver: the version-gate comparison lives in exactly one file --
  check("gallery-version comparison exists ONLY in the canonical resolver", () => {
    const offenders = files.filter(
      (f) => f !== RESOLVER && /verifiedGalleryVersion\s*===/.test(stripComments(read(f))),
    );
    assert.deepEqual(offenders, [], `only ${RESOLVER} may compare gallery versions`);
  });

  check("isPubliclyVerified delegates to the ONE resolver (publicBadgeVisible)", () => {
    const v = read("src/lib/services/verification.ts");
    assert.ok(
      /return publicBadgeVisible\(/.test(v),
      "isPubliclyVerified must delegate to publicBadgeVisible",
    );
  });

  check("no page or API route recomputes badge logic", () => {
    const appFiles = files.filter((f) => f.startsWith("src/app/"));
    const offenders = appFiles.filter((f) => {
      const s = stripComments(read(f));
      return /verifiedGalleryVersion\s*===/.test(s) || /publicBadgeVisible\s*\(/.test(s);
    });
    assert.deepEqual(offenders, [], "pages/APIs must call isPubliclyVerified, never recompute");
  });

  // ---- ONE badge component: no hand-rolled blue check on member surfaces ----
  // The trust badge is a MEMBER signal. Marketing surfaces render decorative
  // illustrations (not gated by any verification state), so they are exempt;
  // every member-facing surface must render <VerifiedBadge/>.
  check("only the canonical badge (or marketing art) renders a filled blue BadgeCheck", () => {
    const isMarketing = (f: string) => f.includes("/marketing/") || f.includes("(marketing)");
    const offenders = files.filter(
      (f) => f !== BADGE && !isMarketing(f) && /<BadgeCheck[^>]*fill-sky/.test(read(f)),
    );
    assert.deepEqual(
      offenders,
      [],
      "member surfaces must render <VerifiedBadge/>, not a raw badge",
    );
  });

  // ---- ONE canonical copy: no divergent / dishonest verification strings ----
  check("no 'Photo verified' badge mislabel and no 'passed photo verification' anywhere", () => {
    const badgeLabelOffenders = files.filter((f) => /aria-label="Photo verified"/.test(read(f)));
    assert.deepEqual(badgeLabelOffenders, [], "no badge may be aria-labelled 'Photo verified'");
    const phraseOffenders = files.filter((f) => /passed photo verification/.test(read(f)));
    assert.deepEqual(phraseOffenders, [], "no 'passed photo verification' copy");
  });

  check(
    "the canonical badge description (rendered copy) is defined in exactly one component",
    () => {
      const holders = files.filter(
        (f) => f.startsWith("src/components/") && /belong to that verified person/.test(read(f)),
      );
      assert.deepEqual(holders, [BADGE], `the trust sentence lives only in ${BADGE}`);
    },
  );

  // ---- the state machine keeps its safety invariant ------------------------
  check("the resolver forbids INVALIDATED/SUSPENDED -> VERIFIED in its transition table", () => {
    const src = read(RESOLVER);
    // INVALIDATED's legal targets must NOT include VERIFIED.
    const inv = src.slice(
      src.indexOf("INVALIDATED: ["),
      src.indexOf("]", src.indexOf("INVALIDATED: [")),
    );
    assert.ok(!/VERIFIED/.test(inv), "INVALIDATED must not transition to VERIFIED");
  });

  // ========================================================================
  // L6.7.1 F-4 hardening: catch weak-predicate / second-resolver / fork
  // regressions that the original guards missed (they let F-2/F-3 pass green).
  // ========================================================================

  // The public badge predicate consumes photoVerifiedAt + faceBadgeSuspendedAt;
  // it may live ONLY in these two files (isPubliclyVerified delegates to the
  // resolver; toVerificationState is the owner mapper in the same module).
  const CANONICAL_PREDICATE = new Set(["src/lib/services/verification.ts", RESOLVER]);

  check(
    "F-4: the weak badge predicate (photoVerifiedAt && !faceBadgeSuspendedAt) lives only in the resolver module",
    () => {
      // Either order, on one line, joined by && - the exact shape of the F-2 fork.
      const weak =
        /photoVerifiedAt[^\n]{0,40}&&[^\n]{0,12}faceBadgeSuspendedAt|faceBadgeSuspendedAt[^\n]{0,40}&&[^\n]{0,12}photoVerifiedAt/;
      const offenders = files.filter(
        (f) => !CANONICAL_PREDICATE.has(f) && weak.test(stripComments(read(f))),
      );
      assert.deepEqual(offenders, [], "no file may recompute badge visibility from raw columns");
    },
  );

  check("F-4: exactly ONE definition of each canonical resolver symbol", () => {
    const defs = {
      resolveTrustState: /export function resolveTrustState\b/,
      publicBadgeVisible: /export function publicBadgeVisible\b/,
      isPubliclyVerified: /export function isPubliclyVerified\b/,
      snapshotVerifiedGallery: /export async function snapshotVerifiedGallery\b/,
    };
    for (const [sym, re] of Object.entries(defs)) {
      const count = files.filter((f) => re.test(read(f))).length;
      assert.equal(count, 1, `exactly one ${sym} definition (found ${count})`);
    }
  });

  check("F-4: galleryVersion is incremented in exactly one file", () => {
    const inc = files.filter((f) => /galleryVersion:\s*{\s*increment/.test(read(f)));
    assert.deepEqual(inc, ["src/lib/services/gallery-integrity.ts"]);
  });

  check("F-4: the immutable snapshot fields are WRITTEN only by snapshotVerifiedGallery", () => {
    const SNAP = "src/lib/services/gallery-integrity.ts";
    // A value write (not a `: true` select, not a `: number|null` type).
    const fieldWrite =
      /(verifiedPhotoIds|verifiedGalleryHash|verifiedCoverPhotoId|verifiedGallerySnapshotAt):\s*(?!true\b|number\b|null\b|string\b|Date\b|DateTime\b)/;
    const offenders = files.filter((f) => f !== SNAP && fieldWrite.test(stripComments(read(f))));
    assert.deepEqual(offenders, [], "snapshot fields have exactly one writer");
  });

  // ---- F-1 restoration guard: only snapshotVerifiedGallery may clear the badge
  const RESTORE_ALLOWED = new Set([
    "src/lib/services/gallery-integrity.ts", // snapshotVerifiedGallery - THE restorer
    "src/lib/services/verification.ts", // type/shape declarations only
    "src/lib/services/face-rehearsal.ts", // rehearsal harness reset (test tooling)
  ]);
  check(
    "F-1: badge RESTORATION (faceBadgeSuspendedAt: null) happens only via the canonical snapshot",
    () => {
      const offenders = files.filter((f) => {
        if (RESTORE_ALLOWED.has(f)) return false;
        const s = stripComments(read(f));
        // A data-write restore, excluding the `where: { ... faceBadgeSuspendedAt: null }` filter.
        return (
          /faceBadgeSuspendedAt:\s*null/.test(s) &&
          !/where:\s*{[^}]*faceBadgeSuspendedAt:\s*null/.test(s)
        );
      });
      assert.deepEqual(offenders, [], "only snapshotVerifiedGallery may restore the badge");
    },
  );

  // ---- F-1 regression: the appeal-reversal path is canonical -----------------
  check("F-1 regression: appeal reversal restores ONLY through snapshotVerifiedGallery", () => {
    const src = read("src/lib/services/face-reference.ts");
    const at = src.indexOf("export async function onFaceViolationReversed");
    const fn = src.slice(at, at + 1600);
    assert.ok(/snapshotVerifiedGallery\(/.test(fn), "must call snapshotVerifiedGallery");
    assert.ok(
      !/faceBadgeSuspendedAt:\s*null/.test(stripComments(fn)),
      "must not bare-write faceBadgeSuspendedAt: null",
    );
  });

  // ---- F-2 regression: admin support view matches the public badge -----------
  check("F-2 regression: admin support badge.visible delegates to isPubliclyVerified", () => {
    const src = read("src/lib/services/verification-support.ts");
    assert.ok(
      /visible:\s*isPubliclyVerified\(/.test(src),
      "badge.visible must call isPubliclyVerified",
    );
    assert.ok(/\.\.\.PUBLIC_BADGE_SELECT/.test(src), "must load PUBLIC_BADGE_SELECT");
    assert.ok(
      !/Boolean\(user\.photoVerifiedAt\)\s*&&\s*!user\.faceBadgeSuspendedAt/.test(src),
      "the manual recompute must be gone",
    );
  });

  // ---- F-3 closure: the removed dual-badge fork may never return -------------
  check("F-3: the dormant dual-badge fork names are never re-exported", () => {
    const forbidden = [
      "publicVerificationBadge",
      "isPhotoVerifiedBadge",
      "ownerVerificationPresentation",
      "VERIFICATION_BADGE_LABEL",
    ];
    const offenders = [];
    for (const f of files) {
      const src = read(f);
      for (const name of forbidden) {
        if (new RegExp(`export (function|const|type|async function) ${name}\\b`).test(src)) {
          offenders.push(`${f}:${name}`);
        }
      }
    }
    assert.deepEqual(offenders, [], "a second public-badge presentation utility must not reappear");
  });

  console.log(`\n${passed} checks passed`);
}

main();
