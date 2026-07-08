import { db } from "@/lib/db";
import { PHOTOS_BUCKET } from "@/lib/services/photos";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Photo moderation - provider architecture.
 *
 * `moderatePhoto(photoId)` is the single automated entry point, called once
 * from POST /api/photos right after the Photo row is created. It picks a
 * provider (env-driven), asks it for a {@link ModerationVerdict}, and applies
 * the verdict transactionally to the row plus an append-only
 * PhotoModerationEvent. Humans act later through the admin queue
 * (/admin/photos), which writes its own events with an actorId.
 *
 * Category surface a real provider is expected to cover (each maps to one or
 * more `labels` on the verdict):
 *  - nudity / sexual content
 *  - violence / weapons / blood
 *  - drugs
 *  - hate symbols
 *  - minors
 *  - text / logos / QR codes
 *  - screenshots / memes
 *  - AI-generated faces
 *  - multiple faces
 *  - no face
 *  - animal instead of a person
 */

export type ModerationDecision = "safe" | "review" | "rejected";

export type ModerationVerdict = {
  decision: ModerationDecision;
  /** Provider confidence/risk score, or null when no provider scored the image. NEVER fabricated. */
  aiScore: number | null;
  /** null = detection unavailable (e.g. no provider), NOT "no face". */
  faceDetected: boolean | null;
  facesCount: number | null;
  /** Category labels from the surface documented above (or ["unmoderated"]). */
  labels: string[];
  reason?: string;
};

export type ModerationInput = {
  /** Raw image bytes (card variant) - preferred, since the bucket is private. */
  buffer?: Buffer;
  /** Publicly fetchable URL, if the deployment exposes one to the provider. */
  imageUrl?: string;
};

export type ModerationContext = {
  photoId: string;
  userId: string;
  isCover: boolean;
  mimeType: string | null;
};

export interface ModerationProvider {
  name: string;
  analyze(input: ModerationInput, context: ModerationContext): Promise<ModerationVerdict>;
}

/**
 * Fallback when no moderation provider is configured. Auto-approves so the
 * product remains usable in dev/self-hosted setups, but records the truth:
 * labels ["unmoderated"], reason "no moderation provider configured", and all
 * detection fields null (we never invent scores or face data). Every use is
 * also logged server-side.
 */
export const nullProvider: ModerationProvider = {
  name: "null",
  async analyze(): Promise<ModerationVerdict> {
    return {
      decision: "safe",
      aiScore: null,
      faceDetected: null,
      facesCount: null,
      labels: ["unmoderated"],
      reason: "no moderation provider configured",
    };
  },
};

/** Shape we map a generic external moderation API response from. */
type ExternalModerationResponse = {
  decision?: unknown;
  score?: unknown;
  faceDetected?: unknown;
  facesCount?: unknown;
  labels?: unknown;
  reason?: unknown;
};

/**
 * INTEGRATION POINT for a real moderation service (AWS Rekognition proxy,
 * Hive, Sightengine, an internal service, ...). Enabled only when BOTH
 * MODERATION_API_URL and MODERATION_API_KEY are set - `pickProvider` never
 * selects it otherwise. POSTs the card-variant bytes (base64) plus context
 * and maps a generic JSON response; anything the service does not return
 * stays null rather than being invented. An unrecognized decision degrades
 * to "review" so a misbehaving provider can only ever add human review,
 * never auto-publish or auto-reject.
 */
export const externalProvider: ModerationProvider = {
  name: "external",
  async analyze(input, context): Promise<ModerationVerdict> {
    const url = process.env.MODERATION_API_URL;
    const key = process.env.MODERATION_API_KEY;
    if (!url || !key) {
      throw new Error("externalProvider called without MODERATION_API_URL/MODERATION_API_KEY");
    }
    if (!input.buffer && !input.imageUrl) {
      throw new Error("externalProvider needs image bytes or a fetchable URL");
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        image: input.buffer ? input.buffer.toString("base64") : undefined,
        imageUrl: input.imageUrl,
        mimeType: "image/webp", // variants are always webp
        context,
      }),
    });
    if (!res.ok) {
      throw new Error(`moderation API responded ${res.status}`);
    }

    const raw = (await res.json()) as ExternalModerationResponse;

    const decision: ModerationDecision =
      raw.decision === "safe" || raw.decision === "rejected" ? raw.decision : "review";

    return {
      decision,
      aiScore: typeof raw.score === "number" && Number.isFinite(raw.score) ? raw.score : null,
      faceDetected: typeof raw.faceDetected === "boolean" ? raw.faceDetected : null,
      facesCount:
        typeof raw.facesCount === "number" && Number.isInteger(raw.facesCount)
          ? raw.facesCount
          : null,
      labels: Array.isArray(raw.labels) ? raw.labels.filter((l): l is string => typeof l === "string") : [],
      reason: typeof raw.reason === "string" ? raw.reason : undefined,
    };
  },
};

export function pickProvider(): ModerationProvider {
  if (process.env.MODERATION_API_URL && process.env.MODERATION_API_KEY) {
    return externalProvider;
  }
  return nullProvider;
}

/** Verdict decision -> (Photo.moderation, Photo.status, event action). */
const DECISION_STATE = {
  // Visible immediately.
  safe: { moderation: "APPROVED", status: "ACTIVE", action: "auto-approved" },
  // Visible while a human reviews it - the media proxy only blocks REJECTED.
  review: { moderation: "PENDING", status: "ACTIVE", action: "flagged-for-review" },
  // Never public - canViewPhoto/the media proxy enforce this.
  rejected: { moderation: "REJECTED", status: "REJECTED", action: "auto-rejected" },
} as const;

function verdictReason(verdict: ModerationVerdict): string {
  const labels = verdict.labels.length > 0 ? ` [labels: ${verdict.labels.join(", ")}]` : "";
  return `${verdict.reason ?? "no reason provided"}${labels}`;
}

/**
 * Runs automated moderation for one photo and applies the verdict
 * transactionally: row state + detection fields + an audit event, all-or-
 * nothing. Provider failures never throw (the upload must not fail because
 * moderation is down): the photo is left PENDING/ACTIVE for human review and
 * a "moderation-error" event records what happened.
 */
export async function moderatePhoto(photoId: string): Promise<void> {
  const photo = await db.photo.findUnique({
    where: { id: photoId },
    select: { id: true, userId: true, isCover: true, mimeType: true, storagePath: true },
  });
  if (!photo) {
    console.warn(`[moderation] photo ${photoId} vanished before moderation ran`);
    return;
  }

  const provider = pickProvider();
  const context: ModerationContext = {
    photoId: photo.id,
    userId: photo.userId,
    isCover: photo.isCover,
    mimeType: photo.mimeType,
  };

  let verdict: ModerationVerdict;
  try {
    let input: ModerationInput = {};
    if (provider === externalProvider) {
      // The bucket is private, so a real provider gets the bytes, not a URL.
      input = { buffer: await downloadCardVariant(photo.storagePath) };
    }
    verdict = await provider.analyze(input, context);
  } catch (error) {
    console.error(`[moderation] provider "${provider.name}" failed for photo ${photoId}`, error);
    await db.photoModerationEvent.create({
      data: {
        photoId: photo.id,
        actorId: null,
        action: "moderation-error",
        reason: `provider "${provider.name}" failed: ${error instanceof Error ? error.message : "unknown error"}`,
      },
    });
    return; // row keeps its defaults: moderation PENDING, status ACTIVE
  }

  if (provider === nullProvider) {
    // Honest by design: dev/unconfigured installs auto-approve, and both the
    // server log and the event history say so explicitly.
    console.warn(
      `[moderation] no provider configured - photo ${photoId} auto-approved as "unmoderated"`,
    );
  }

  const state = DECISION_STATE[verdict.decision];

  await db.$transaction(async (tx) => {
    await tx.photo.update({
      where: { id: photo.id },
      data: {
        moderation: state.moderation,
        status: state.status,
        aiScore: verdict.aiScore,
        faceDetected: verdict.faceDetected,
        facesCount: verdict.facesCount,
        // Automated decisions stamp the time but never a human reviewer.
        // "review" is not a decision yet, so it leaves moderatedAt unset.
        moderatedAt: verdict.decision === "review" ? null : new Date(),
        moderatedById: null,
      },
    });
    await tx.photoModerationEvent.create({
      data: {
        photoId: photo.id,
        actorId: null, // automated decision
        action: state.action,
        reason: verdictReason(verdict),
        aiScore: verdict.aiScore,
      },
    });
    // Cover rule: warn (never block) when the cover photo has no detected
    // face. Only fires on an explicit `false` - null means "not analyzed".
    if (photo.isCover && verdict.faceDetected === false) {
      await tx.photoModerationEvent.create({
        data: {
          photoId: photo.id,
          actorId: null,
          action: "cover-face-warning",
          reason: "cover photo has no detected face",
        },
      });
    }
  });
}

/** Fetches the card-variant bytes from the private bucket for the provider. */
async function downloadCardVariant(storagePath: string | null): Promise<Buffer> {
  if (!storagePath) throw new Error("photo has no storagePath");
  const supabase = await supabaseServer();
  const { data, error } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .download(`${storagePath}/card.webp`);
  if (error || !data) {
    throw new Error(`could not download card variant: ${error?.message ?? "no data"}`);
  }
  return Buffer.from(await data.arrayBuffer());
}
