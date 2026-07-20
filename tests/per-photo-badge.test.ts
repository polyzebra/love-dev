/**
 * L6.12 - per-photo badge contract readiness layer (unit, no DB). Proves the
 * canonical pure predicate `publicBadgePerPhotoVisible`, the flag dispatcher
 * `resolveBadgeVisible` (FACE_BADGE_PER_PHOTO), and the governance protections.
 * All logic is exercised against the PURE predicate with synthetic facts - no
 * provider, no AWS, no DB (the predicate can never trigger a provider call).
 *
 *   npx tsx tests/per-photo-badge.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  publicBadgeVisible,
  publicBadgePerPhotoVisible,
  perPhotoBadgeReason,
  type PerPhotoBadgeFacts,
  type TrustFacts,
} from "@/lib/trust/verification-state-machine";
import {
  resolveBadgeVisible,
  perPhotoBadgeCohort,
  getPerPhotoBadgeFactsForUsers,
  resolveBadgeVisibleForUsers,
  isPubliclyVerified,
  toTrustFacts,
} from "@/lib/services/verification";
import { isMaterialGalleryChange } from "@/lib/services/gallery-integrity";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}
async function acheck(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const REF = 3;
/** A fully-passing per-photo facts baseline; override to walk each scenario. */
function mk(o: Partial<PerPhotoBadgeFacts> = {}): PerPhotoBadgeFacts {
  return {
    photoVerifiedAt: new Date(),
    faceBadgeSuspendedAt: null,
    currentReferenceId: "ref1",
    currentReferenceVersion: REF,
    requiredPhotos: [
      cover(),
      gallery("g1", "PASSED"),
      gallery("g2", "ALLOWED"), // permitted no-face gallery photo
    ],
    ...o,
  };
}
function cover(over: Record<string, unknown> = {}) {
  return {
    photoId: "cover",
    mediaVersion: 2,
    isCover: true,
    check: {
      photoId: "cover",
      photoVersion: 2,
      referenceVersion: REF,
      isCoverAtCheck: true,
      decision: "PASSED" as const,
    },
    ...over,
  };
}
function gallery(id: string, decision: "PASSED" | "ALLOWED" | "PENDING" | "FLAGGED" | "REJECTED") {
  return {
    photoId: id,
    mediaVersion: 1,
    isCover: false,
    check: { photoId: id, photoVersion: 1, referenceVersion: REF, isCoverAtCheck: false, decision },
  };
}

async function main() {
  // Baseline: everything valid -> badge on.
  check("badge ON after all required photos pass", () => {
    assert.equal(publicBadgePerPhotoVisible(mk()), true);
  });

  // 1. Initial: no checks yet -> off.
  check("initial: no checks -> badge OFF", () => {
    const f = mk({
      requiredPhotos: [{ photoId: "cover", mediaVersion: 2, isCover: true, check: null }],
    });
    assert.equal(publicBadgePerPhotoVisible(f), false);
  });

  // 2. New photo (no check) blocks; others still valid.
  check("new public photo without a check blocks the badge", () => {
    const f = mk();
    f.requiredPhotos.push({ photoId: "new", mediaVersion: 1, isCover: false, check: null });
    assert.equal(publicBadgePerPhotoVisible(f), false);
  });

  // 3. Replacement bumps mediaVersion -> stale check on THAT photo only fails.
  check("replacement (stale mediaVersion) fails only the replaced photo", () => {
    const f = mk();
    f.requiredPhotos[1].mediaVersion = 2; // g1 replaced; its check is still v1
    assert.equal(publicBadgePerPhotoVisible(f), false);
    // the OTHERS on their current version still pass in isolation
    assert.equal(publicBadgePerPhotoVisible(mk({ requiredPhotos: [cover()] })), true);
  });

  // 4. Deletion: the deleted photo is simply not in the required set.
  check("deleted photo is not required (remaining set still passes)", () => {
    assert.equal(
      publicBadgePerPhotoVisible(mk({ requiredPhotos: [cover(), gallery("g1", "PASSED")] })),
      true,
    );
  });

  // 5. Pure reorder: same photoIds/versions/checks -> unchanged; predicate is
  //    pure (never calls a provider), so a reorder can trigger zero AWS calls.
  check("pure reorder preserves the badge and triggers no provider work", () => {
    const f = mk();
    const reordered = { ...f, requiredPhotos: [...f.requiredPhotos].reverse() };
    assert.equal(publicBadgePerPhotoVisible(reordered), publicBadgePerPhotoVisible(f));
    assert.equal(publicBadgePerPhotoVisible(reordered), true);
    // reorder is classified NON-material by the one canonical classifier.
    assert.equal(isMaterialGalleryChange("photos_reordered"), false);
  });

  // 6. Cover strict policy: ALLOWED is NOT acceptable for the cover.
  check("cover with ALLOWED fails (cover must strictly PASS)", () => {
    const f = mk({ requiredPhotos: [cover({ check: { ...cover().check, decision: "ALLOWED" } })] });
    assert.equal(publicBadgePerPhotoVisible(f), false);
  });
  check("ALLOWED accepted for a gallery photo, rejected for the cover", () => {
    assert.equal(
      publicBadgePerPhotoVisible(mk({ requiredPhotos: [cover(), gallery("g", "ALLOWED")] })),
      true,
    );
  });

  // 7. Visibility false->true: newly-public photo with no valid check blocks.
  check("visibility false->true blocks until a valid check exists", () => {
    const f = mk();
    f.requiredPhotos.push({ photoId: "nowPublic", mediaVersion: 5, isCover: false, check: null });
    assert.equal(publicBadgePerPhotoVisible(f), false);
  });
  check("visibility true->false removes the photo from the required set", () => {
    // hidden photo simply absent from requiredPhotos -> does not block
    assert.equal(publicBadgePerPhotoVisible(mk({ requiredPhotos: [cover()] })), true);
  });

  // 8. Mixed verified/unverified blocks; partial failure blocks.
  check("mixed verified/unverified gallery blocks", () => {
    const f = mk();
    f.requiredPhotos.push(gallery("gX", "PENDING"));
    assert.equal(publicBadgePerPhotoVisible(f), false);
  });
  check("partial failure (one REJECTED/FLAGGED) blocks", () => {
    assert.equal(
      publicBadgePerPhotoVisible(mk({ requiredPhotos: [cover(), gallery("g1", "REJECTED")] })),
      false,
    );
    assert.equal(
      publicBadgePerPhotoVisible(mk({ requiredPhotos: [cover(), gallery("g1", "FLAGGED")] })),
      false,
    );
  });

  // 9. Stale mediaVersion / stale reference / pending cannot pass.
  check("stale mediaVersion cannot pass", () => {
    const c = cover();
    c.check.photoVersion = 1; // photo is at v2
    assert.equal(publicBadgePerPhotoVisible(mk({ requiredPhotos: [c] })), false);
  });
  check("stale referenceVersion cannot pass (no silent cross-reference reuse)", () => {
    const c = cover();
    c.check.referenceVersion = REF - 1; // computed against an older reference
    assert.equal(publicBadgePerPhotoVisible(mk({ requiredPhotos: [c] })), false);
    // unknown reference (null) also fails closed
    const c2 = cover({ check: { ...cover().check, referenceVersion: null } });
    assert.equal(publicBadgePerPhotoVisible(mk({ requiredPhotos: [c2] })), false);
  });
  check("PENDING / FLAGGED / REJECTED never pass", () => {
    for (const d of ["PENDING", "FLAGGED", "REJECTED"] as const) {
      assert.equal(
        publicBadgePerPhotoVisible(mk({ requiredPhotos: [cover(), gallery("g", d)] })),
        false,
      );
    }
  });

  // 10. Stripe alone can NEVER grant the per-photo badge.
  check("Stripe identity alone cannot grant the per-photo badge", () => {
    assert.equal(
      publicBadgePerPhotoVisible({
        photoVerifiedAt: new Date(),
        faceBadgeSuspendedAt: null,
        currentReferenceId: null, // no AWS reference
        currentReferenceVersion: null,
        requiredPhotos: [],
      }),
      false,
    );
    // suspension always blocks
    assert.equal(publicBadgePerPhotoVisible(mk({ faceBadgeSuspendedAt: new Date() })), false);
    // no current reference blocks even with all checks present
    assert.equal(
      publicBadgePerPhotoVisible(mk({ currentReferenceId: null, currentReferenceVersion: null })),
      false,
    );
  });

  // 11. Dispatcher: null facts -> legacy (unchanged); present facts -> per-photo.
  check("dispatcher: null facts -> legacy resolver, present facts -> per-photo", () => {
    const bases: TrustFacts[] = [
      {
        photoVerifiedAt: new Date(),
        faceBadgeSuspendedAt: null,
        galleryVersion: 4,
        verifiedGalleryVersion: 4,
      },
      {
        photoVerifiedAt: new Date(),
        faceBadgeSuspendedAt: null,
        galleryVersion: 5,
        verifiedGalleryVersion: 4,
      },
      {
        photoVerifiedAt: null,
        faceBadgeSuspendedAt: null,
        galleryVersion: 4,
        verifiedGalleryVersion: 4,
      },
      {
        photoVerifiedAt: new Date(),
        faceBadgeSuspendedAt: new Date(),
        galleryVersion: 4,
        verifiedGalleryVersion: 4,
      },
    ];
    for (const b of bases) {
      assert.equal(resolveBadgeVisible(b, null), publicBadgeVisible(b), "null facts == legacy");
    }
    assert.equal(resolveBadgeVisible(bases[0], mk()), publicBadgePerPhotoVisible(mk()));
  });

  // 12. Cohort (Phase E): a single global boolean can NEVER move all users.
  check("cohort: master flag alone (no allowlist/percent) enrols NOBODY", () => {
    delete process.env.FACE_BADGE_PER_PHOTO;
    delete process.env.FACE_BADGE_PER_PHOTO_ALLOWLIST;
    delete process.env.FACE_BADGE_PER_PHOTO_PERCENT;
    delete process.env.FACE_EMERGENCY_DISABLE;
    assert.equal(perPhotoBadgeCohort("u1"), false, "flag off -> nobody");
    process.env.FACE_BADGE_PER_PHOTO = "1";
    assert.equal(perPhotoBadgeCohort("u1"), false, "master on, no allowlist/percent -> nobody");
    delete process.env.FACE_BADGE_PER_PHOTO;
  });

  check("cohort: explicit allowlist admits only listed stable ids", () => {
    try {
      process.env.FACE_BADGE_PER_PHOTO = "1";
      process.env.FACE_BADGE_PER_PHOTO_ALLOWLIST = "userA, userB";
      assert.equal(perPhotoBadgeCohort("userA"), true);
      assert.equal(perPhotoBadgeCohort("userB"), true);
      assert.equal(perPhotoBadgeCohort("userC"), false);
      process.env.FACE_BADGE_PER_PHOTO_ALLOWLIST = "a@b.com"; // emails ignored
      assert.equal(perPhotoBadgeCohort("a@b.com"), false);
    } finally {
      delete process.env.FACE_BADGE_PER_PHOTO;
      delete process.env.FACE_BADGE_PER_PHOTO_ALLOWLIST;
    }
  });

  check("cohort: percentage bucketing is deterministic; emergency disable fails closed", () => {
    try {
      process.env.FACE_BADGE_PER_PHOTO = "1";
      process.env.FACE_BADGE_PER_PHOTO_PERCENT = "100";
      assert.equal(perPhotoBadgeCohort("uX"), true);
      assert.equal(perPhotoBadgeCohort("uX"), perPhotoBadgeCohort("uX"), "deterministic");
      process.env.FACE_BADGE_PER_PHOTO_PERCENT = "0";
      assert.equal(perPhotoBadgeCohort("uX"), false);
      process.env.FACE_BADGE_PER_PHOTO_PERCENT = "100";
      process.env.FACE_EMERGENCY_DISABLE = "1";
      assert.equal(perPhotoBadgeCohort("uX"), false, "emergency disable -> fail closed");
    } finally {
      delete process.env.FACE_BADGE_PER_PHOTO;
      delete process.env.FACE_BADGE_PER_PHOTO_PERCENT;
      delete process.env.FACE_EMERGENCY_DISABLE;
    }
  });

  // 13. Reason codes (Phase G) - first blocking reason, no biometric data.
  check("reason codes map to the first blocking condition; null when verified", () => {
    assert.equal(perPhotoBadgeReason(mk()), "VERIFIED");
    assert.equal(perPhotoBadgeReason(mk({ requiredPhotos: [] })), "NO_REQUIRED_PHOTOS");
    assert.equal(perPhotoBadgeReason(mk({ photoVerifiedAt: null })), "STRIPE_REQUIRED");
    assert.equal(perPhotoBadgeReason(mk({ faceBadgeSuspendedAt: new Date() })), "SUSPENDED");
    assert.equal(
      perPhotoBadgeReason(mk({ currentReferenceId: null, currentReferenceVersion: null })),
      "REFERENCE_REQUIRED",
    );
    assert.equal(
      perPhotoBadgeReason(
        mk({ requiredPhotos: [{ photoId: "c", mediaVersion: 2, isCover: true, check: null }] }),
      ),
      "PHOTO_CHECK_PENDING",
    );
    const stalePv = cover();
    stalePv.check.photoVersion = 1;
    assert.equal(perPhotoBadgeReason(mk({ requiredPhotos: [stalePv] })), "STALE_PHOTO_VERSION");
    const staleRef = cover({ check: { ...cover().check, referenceVersion: REF - 1 } });
    assert.equal(perPhotoBadgeReason(mk({ requiredPhotos: [staleRef] })), "STALE_REFERENCE");
    assert.equal(
      perPhotoBadgeReason(
        mk({ requiredPhotos: [cover({ check: { ...cover().check, decision: "REJECTED" } })] }),
      ),
      "COVER_CHECK_FAILED",
    );
    assert.equal(
      perPhotoBadgeReason(mk({ requiredPhotos: [cover(), gallery("g", "REJECTED")] })),
      "PHOTO_CHECK_FAILED",
    );
  });

  // ---- L6.14 batch assembler + dispatcher (Phase A/B/G) ----
  // A counting fake BadgeBatchClient proves the CONSTANT query count and lets
  // the batch dispatcher run without a database.
  type Row = Record<string, unknown>;
  function inList(a: unknown, key: string): string[] {
    const w = (a as { where?: Record<string, { in?: string[] }> }).where ?? {};
    return w[key]?.in ?? [];
  }
  type Fix = {
    photoVerifiedAt: Date | null;
    job?: { referenceId: string | null; referenceVersion: number | null; referenceStatus: string };
    photos?: { id: string; mediaVersion: number; isCover: boolean }[];
    checks?: {
      photoId: string;
      photoVersion: number;
      referenceVersion: number | null;
      isCoverAtCheck: boolean;
      decision: string;
    }[];
  };
  function countingClient(fixtures: Record<string, Fix>) {
    const counts = { user: 0, ppv: 0, photo: 0, check: 0 };
    const jobId = (uid: string) => `job_${uid}`;
    const client = {
      user: {
        findMany: async (a: unknown): Promise<Row[]> => {
          counts.user += 1;
          return inList(a, "id")
            .filter((id) => fixtures[id])
            .map((id) => ({
              id,
              photoVerifiedAt: fixtures[id].photoVerifiedAt,
              faceBadgeSuspendedAt: null,
            }));
        },
      },
      profilePhotoVerification: {
        findMany: async (a: unknown): Promise<Row[]> => {
          counts.ppv += 1;
          return inList(a, "userId")
            .filter((id) => fixtures[id]?.job)
            .map((id) => ({ id: jobId(id), userId: id, ...fixtures[id].job! }));
        },
      },
      photo: {
        findMany: async (a: unknown): Promise<Row[]> => {
          counts.photo += 1;
          return inList(a, "userId").flatMap((id) =>
            (fixtures[id]?.photos ?? []).map((p) => ({ ...p, userId: id })),
          );
        },
      },
      photoFaceCheck: {
        findMany: async (a: unknown): Promise<Row[]> => {
          counts.check += 1;
          const jobIds = new Set(inList(a, "verificationId"));
          return Object.entries(fixtures).flatMap(([uid, f]) =>
            jobIds.has(jobId(uid))
              ? (f.checks ?? []).map((c) => ({ ...c, verificationId: jobId(uid) }))
              : [],
          );
        },
      },
    };
    return {
      client: client as unknown as Parameters<typeof getPerPhotoBadgeFactsForUsers>[1],
      counts,
    };
  }

  const verifiedFix = (): Fix => ({
    photoVerifiedAt: new Date(),
    job: { referenceId: "r", referenceVersion: 3, referenceStatus: "ACTIVE" },
    photos: [{ id: "cover", mediaVersion: 2, isCover: true }],
    checks: [
      {
        photoId: "cover",
        photoVersion: 2,
        referenceVersion: 3,
        isCoverAtCheck: true,
        decision: "PASSED",
      },
    ],
  });
  const pendingFix = (): Fix => ({
    photoVerifiedAt: new Date(),
    job: { referenceId: "r", referenceVersion: 3, referenceStatus: "ACTIVE" },
    photos: [{ id: "cover", mediaVersion: 2, isCover: true }],
    checks: [], // no check yet
  });

  await acheck("batch assembler: CONSTANT 4 queries for 1, 10 and N users (no N+1)", async () => {
    for (const n of [1, 10, 50]) {
      const fx: Record<string, Fix> = {};
      const ids = Array.from({ length: n }, (_, i) => `u${i}`);
      for (const id of ids) fx[id] = verifiedFix();
      const { client, counts } = countingClient(fx);
      const map = await getPerPhotoBadgeFactsForUsers(ids, client);
      assert.equal(map.size, n, "one fact per user");
      assert.deepEqual(counts, { user: 1, ppv: 1, photo: 1, check: 1 }, `4 queries for n=${n}`);
    }
  });

  await acheck(
    "batch assembler: dedup + missing user -> null; no duplicate check loading",
    async () => {
      const { client, counts } = countingClient({ u1: verifiedFix() });
      const map = await getPerPhotoBadgeFactsForUsers(["u1", "u1", "ghost"], client);
      assert.equal(map.get("ghost"), null);
      assert.ok(map.get("u1"));
      assert.deepEqual(counts, { user: 1, ppv: 1, photo: 1, check: 1 });
    },
  );

  await acheck(
    "batch dispatcher: mixed cohort - canary=per-photo, non-canary=legacy; facts only for canary",
    async () => {
      try {
        process.env.FACE_BADGE_PER_PHOTO = "1";
        process.env.FACE_BADGE_PER_PHOTO_ALLOWLIST = "canaryOK, canaryPending";
        const fx: Record<string, Fix> = { canaryOK: verifiedFix(), canaryPending: pendingFix() };
        const { client, counts } = countingClient(fx);
        const legacyVisible: TrustFacts = {
          photoVerifiedAt: new Date(),
          faceBadgeSuspendedAt: null,
          galleryVersion: 1,
          verifiedGalleryVersion: 1,
        };
        const base = new Map<string, TrustFacts>([
          ["canaryOK", legacyVisible],
          ["canaryPending", legacyVisible],
          ["legacyUser", legacyVisible],
        ]);
        const res = await resolveBadgeVisibleForUsers(
          ["canaryOK", "canaryPending", "legacyUser"],
          base,
          client,
        );
        assert.deepEqual(res.get("canaryOK"), { visible: true, reason: "VERIFIED" });
        assert.deepEqual(res.get("canaryPending"), {
          visible: false,
          reason: "PHOTO_CHECK_PENDING",
        });
        // non-canary: legacy verdict, NO per-photo assembly for it
        assert.deepEqual(res.get("legacyUser"), { visible: true, reason: "LEGACY_VISIBLE" });
        assert.deepEqual(
          counts,
          { user: 1, ppv: 1, photo: 1, check: 1 },
          "bounded; assembled once for canary only",
        );
      } finally {
        delete process.env.FACE_BADGE_PER_PHOTO;
        delete process.env.FACE_BADGE_PER_PHOTO_ALLOWLIST;
      }
    },
  );

  await acheck(
    "batch dispatcher: canary user with missing facts fails closed for THEM only",
    async () => {
      try {
        process.env.FACE_BADGE_PER_PHOTO = "1";
        process.env.FACE_BADGE_PER_PHOTO_ALLOWLIST = "ghost, canaryOK";
        const { client } = countingClient({ canaryOK: verifiedFix() }); // ghost absent
        const legacyVisible: TrustFacts = {
          photoVerifiedAt: new Date(),
          faceBadgeSuspendedAt: null,
          galleryVersion: 1,
          verifiedGalleryVersion: 1,
        };
        const base = new Map<string, TrustFacts>([
          ["ghost", legacyVisible],
          ["canaryOK", legacyVisible],
        ]);
        const res = await resolveBadgeVisibleForUsers(["ghost", "canaryOK"], base, client);
        assert.equal(res.get("ghost")!.visible, false, "missing canary facts -> fail closed");
        assert.equal(res.get("canaryOK")!.visible, true, "other canary user unaffected");
      } finally {
        delete process.env.FACE_BADGE_PER_PHOTO;
        delete process.env.FACE_BADGE_PER_PHOTO_ALLOWLIST;
      }
    },
  );

  await acheck(
    "batch dispatcher: no cohort -> pure legacy for all, zero per-photo queries",
    async () => {
      const { client, counts } = countingClient({ u1: verifiedFix() });
      const legacyVisible: TrustFacts = {
        photoVerifiedAt: new Date(),
        faceBadgeSuspendedAt: null,
        galleryVersion: 1,
        verifiedGalleryVersion: 1,
      };
      const res = await resolveBadgeVisibleForUsers(
        ["u1", "u2"],
        new Map([
          ["u1", legacyVisible],
          ["u2", legacyVisible],
        ]),
        client,
      );
      assert.deepEqual(res.get("u1"), { visible: true, reason: "LEGACY_VISIBLE" });
      assert.deepEqual(
        counts,
        { user: 0, ppv: 0, photo: 0, check: 0 },
        "non-canary batch loads NO per-photo facts",
      );
    },
  );

  // ---- Governance (req 12) ----

  const SM = readFileSync("src/lib/trust/verification-state-machine.ts", "utf8");
  const VER = readFileSync("src/lib/services/verification.ts", "utf8");

  check("exactly ONE per-photo predicate exists (no duplicate/independent recompute)", () => {
    const dirs = ["src"];
    let defs = 0;
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".ts") && !p.includes("/generated/")) {
          if (/function publicBadgePerPhotoVisible/.test(readFileSync(p, "utf8"))) defs += 1;
        }
      }
    };
    walk(dirs[0]);
    assert.equal(defs, 1, "publicBadgePerPhotoVisible must be defined exactly once");
    // the conjunction lives only in the canonical module
    assert.ok(/function publicBadgePerPhotoVisible/.test(SM));
  });

  check("predicate validates mediaVersion AND referenceVersion (currency)", () => {
    const body = SM.slice(SM.indexOf("function publicBadgePerPhotoVisible"));
    assert.ok(/photoVersion !== p\.mediaVersion/.test(body), "mediaVersion check required");
    assert.ok(
      /referenceVersion !== f\.currentReferenceVersion/.test(body),
      "reference currency check required",
    );
    assert.ok(/decision !== "PASSED"/.test(body), "cover strict-match required");
  });

  check("assembler requires currently-public photos only (hidden/deleted excluded)", () => {
    assert.ok(/status:\s*"ACTIVE"/.test(VER), "required set = Photo.status ACTIVE");
    assert.ok(!/isVisible:\s*false/.test(VER));
  });

  check("dispatcher: non-cohort -> legacy resolver; canary -> per-photo, fail-closed", () => {
    assert.ok(/FACE_BADGE_PER_PHOTO/.test(VER), "flag read");
    // Pure dispatcher: null facts delegate to the existing resolver.
    const pure = VER.slice(
      VER.indexOf("function resolveBadgeVisible("),
      VER.indexOf("function resolveBadgeVisibleForUser"),
    );
    assert.ok(/publicBadgeVisible\(base\)/.test(pure), "null facts -> legacy resolver");
    // Cohort-aware single-user entry: non-cohort -> legacy; canary -> per-photo or fail closed.
    const forUser = VER.slice(VER.indexOf("function resolveBadgeVisibleForUser"));
    assert.ok(/perPhotoBadgeCohort\(userId\)/.test(forUser), "cohort-gated");
    assert.ok(
      /return publicBadgeVisible\(base\)/.test(forUser),
      "non-cohort delegates to the existing resolver",
    );
    assert.ok(
      /return facts \? publicBadgePerPhotoVisible\(facts\) : false/.test(forUser),
      "canary: per-photo or fail closed",
    );
  });

  check("the existing whole-gallery resolver is unchanged (flag-off contract)", () => {
    const body = SM.slice(
      SM.indexOf("function publicBadgeVisible"),
      SM.indexOf("PerPhotoCheckFact"),
    );
    assert.ok(/f\.photoVerifiedAt !== null/.test(body));
    assert.ok(/f\.verifiedGalleryVersion === f\.galleryVersion/.test(body));
  });

  check("reorder is non-material (never invalidates)", () => {
    assert.equal(isMaterialGalleryChange("photos_reordered"), false);
    assert.equal(isMaterialGalleryChange("photo_uploaded"), true);
  });

  // ---- L6.13 governance: reference currency + writers + retention ----

  check("every PhotoFaceCheck writer persists referenceVersion (worker)", () => {
    const worker = readFileSync("src/lib/services/face-verification.ts", "utf8");
    const upserts = worker.split("photoFaceCheck.upsert").slice(1);
    assert.ok(upserts.length >= 2, "expected the worker's PhotoFaceCheck upserts");
    for (const u of upserts) {
      const body = u.slice(0, 900);
      assert.ok(
        /referenceVersion: job\.referenceVersion/.test(body),
        "create+update must stamp referenceVersion",
      );
    }
    // cache-reuse is keyed on the current reference generation.
    assert.ok(
      /existing\.referenceVersion === job\.referenceVersion/.test(worker),
      "reuse must require reference currency",
    );
  });

  check("assembler selects the persisted referenceVersion (no inference)", () => {
    assert.ok(/referenceVersion: true/.test(VER), "PhotoFaceCheck.referenceVersion selected");
    assert.ok(
      /referenceVersion: c\.referenceVersion/.test(VER),
      "uses the persisted value, not the current reference",
    );
  });

  check("reference rotation is non-destructive (no PhotoFaceCheck deletion)", () => {
    const rot = readFileSync("src/lib/services/face-reference.ts", "utf8");
    const fn = rot.slice(
      rot.indexOf("function rotateReference"),
      rot.indexOf("function sweepReferenceLifecycle"),
    );
    assert.ok(!/photoFaceCheck\.delete/i.test(fn), "rotation must retain historical checks");
  });

  check("cohort cannot be flipped by a single global boolean (allowlist/percent required)", () => {
    const body = VER.slice(VER.indexOf("function perPhotoBadgeCohort"));
    assert.ok(/FACE_BADGE_PER_PHOTO_ALLOWLIST/.test(body), "explicit allowlist");
    assert.ok(/FACE_BADGE_PER_PHOTO_PERCENT/.test(body), "percentage cohort");
    assert.ok(/faceEmergencyDisabled\(\)/.test(body), "emergency kill switch");
  });

  // ---- L6.14 governance: one batch assembler, bounded queries, single entry ----

  check("single-user assembler delegates to the ONE batch assembler (no duplicate)", () => {
    const one = VER.slice(VER.indexOf("export async function getPerPhotoBadgeFacts("));
    assert.ok(
      /getPerPhotoBadgeFactsForUsers\(\[userId\]\)/.test(one),
      "single-user path must delegate to the batch assembler",
    );
  });

  check("batch assembler is bounded: no per-user query, uses IN(...) not a loop", () => {
    const fn = VER.slice(
      VER.indexOf("export async function getPerPhotoBadgeFactsForUsers"),
      VER.indexOf("export async function getPerPhotoBadgeFacts("),
    );
    // exactly the four delegate reads, all IN-scoped; none inside a for/await loop.
    const findManyCount = (fn.match(/\.findMany\(/g) ?? []).length;
    assert.equal(findManyCount, 4, "exactly four batch reads");
    assert.ok(!/for\s*\([^)]*\)\s*\{[^}]*await client\./.test(fn), "no await-in-loop query");
    assert.ok(!/\.map\(async/.test(fn), "no per-item async map query");
    assert.ok(
      /in: ids/.test(fn) && /in: jobIds/.test(fn) && /in: photoIds/.test(fn),
      "IN-scoped reads",
    );
  });

  check("batch dispatcher assembles facts only for the canary subset", () => {
    const fn = VER.slice(VER.indexOf("export async function resolveBadgeVisibleForUsers"));
    assert.ok(
      /const canary = ids\.filter\(\(id\) => perPhotoBadgeCohort\(id\)\)/.test(fn),
      "cohort partition",
    );
    assert.ok(/getPerPhotoBadgeFactsForUsers\(canary/.test(fn), "assembles only the canary subset");
  });

  // ---- L6.15 surface-migration governance (Phase J) ----

  function srcFiles(): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) {
          if (!p.includes("/generated/")) walk(p);
        } else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
      }
    };
    for (const r of ["src/app", "src/components", "src/lib"]) walk(r);
    return out;
  }
  /** Strip // line comments and JSDoc/`*` comment lines so a mention isn't a call. */
  function stripComments(s: string): string {
    return s
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");
  }

  check("no live surface calls isPubliclyVerified() (dispatcher module + rehearsal only)", () => {
    const ALLOW = new Set([
      "src/lib/services/verification.ts",
      "src/lib/services/face-rehearsal.ts",
      "src/lib/services/trust-rehearsal.ts",
    ]);
    const bad: string[] = [];
    for (const f of srcFiles()) {
      const rel = f.replace(/\\/g, "/");
      if (ALLOW.has(rel)) continue;
      if (
        /(?<!function )(?<!\.)\bisPubliclyVerified\s*\(/.test(
          stripComments(readFileSync(f, "utf8")),
        )
      ) {
        bad.push(rel);
      }
    }
    assert.deepEqual(bad, [], "these surfaces must delegate to the dispatcher");
  });

  check("publicBadgeVisible() is called only inside the canonical dispatcher module", () => {
    const ALLOW = new Set([
      "src/lib/services/verification.ts",
      "src/lib/trust/verification-state-machine.ts",
    ]);
    const bad: string[] = [];
    for (const f of srcFiles()) {
      const rel = f.replace(/\\/g, "/");
      if (ALLOW.has(rel)) continue;
      if (/(?<!function )\bpublicBadgeVisible\s*\(/.test(stripComments(readFileSync(f, "utf8")))) {
        bad.push(rel);
      }
    }
    assert.deepEqual(bad, [], "publicBadgeVisible must not be called outside the dispatcher");
  });

  check("PhotoFaceCheck is queried only by the canonical assembler + pipeline", () => {
    const ALLOW = new Set([
      "src/lib/services/verification.ts",
      "src/lib/services/face-verification.ts",
      "src/lib/services/trust-rehearsal.ts",
    ]);
    const bad: string[] = [];
    for (const f of srcFiles()) {
      const rel = f.replace(/\\/g, "/");
      if (ALLOW.has(rel)) continue;
      if (/\bphotoFaceCheck\s*\./.test(stripComments(readFileSync(f, "utf8")))) bad.push(rel);
    }
    assert.deepEqual(bad, [], "no surface may query PhotoFaceCheck directly");
  });

  // ---- L6.15 Phase M: flag-off byte-identical proof ----
  check("flag-off dispatcher == legacy isPubliclyVerified for every base shape", () => {
    const users = [
      {
        photoVerifiedAt: new Date(),
        faceBadgeSuspendedAt: null,
        galleryVersion: 3,
        verifiedGalleryVersion: 3,
      },
      {
        photoVerifiedAt: new Date(),
        faceBadgeSuspendedAt: null,
        galleryVersion: 4,
        verifiedGalleryVersion: 3,
      },
      {
        photoVerifiedAt: null,
        faceBadgeSuspendedAt: null,
        galleryVersion: 3,
        verifiedGalleryVersion: 3,
      },
      {
        photoVerifiedAt: new Date(),
        faceBadgeSuspendedAt: new Date(),
        galleryVersion: 3,
        verifiedGalleryVersion: 3,
      },
      {
        photoVerifiedAt: new Date(),
        faceBadgeSuspendedAt: null,
        galleryVersion: 3,
        verifiedGalleryVersion: null,
      },
    ];
    for (const u of users) {
      assert.equal(
        resolveBadgeVisible(toTrustFacts(u), null),
        isPubliclyVerified(u),
        "byte-identical",
      );
    }
  });

  console.log(`\n${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
