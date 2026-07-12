import { db } from "@/lib/db";
import {
  NULL_SCORES,
  type ModerationDecision,
  type ModerationInput,
  type ModerationProvider,
  type ModerationScores,
  type ModerationVerdict,
} from "@/lib/services/moderation";

/**
 * Real moderation provider adapters + the ordered fallback chain.
 *
 * Selection: MODERATION_PROVIDERS is an ordered comma list, e.g.
 * "openai,google_vision,hive,external". Each name maps to an adapter below;
 * unconfigured entries are skipped at call time with an honest log line.
 * The chain tries each provider with a per-provider timeout
 * (MODERATION_TIMEOUT_MS, default 8000ms via AbortSignal); on failure it
 * records ProviderHealth and moves to the next; when EVERY provider fails
 * it throws, which lands in moderatePhoto's existing catch: a FAILED
 * PhotoModerationResult + needs_review - NEVER an approval, NEVER invented
 * scores.
 *
 * Mapping discipline: only fields a provider actually returned are set;
 * everything else stays null. No adapter ever fabricates a face count or a
 * score.
 *
 * Documented stubs (no clean keyless REST path - each needs SigV4/SDK):
 *  - AWS Rekognition (aws_rekognition): DetectModerationLabels +
 *    DetectFaces. Envs when it ships: AWS_REKOGNITION_REGION,
 *    AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY. Mapping: Explicit
 *    Nudity/Suggestive -> adultScore, Violence/Visually Disturbing ->
 *    violenceScore, Child Exploitative -> minorRiskScore (all /100).
 *  - Azure Content Safety (azure): POST {endpoint}/contentsafety/image:analyze
 *    with Ocp-Apim-Subscription-Key. Envs: AZURE_CONTENT_SAFETY_ENDPOINT,
 *    AZURE_CONTENT_SAFETY_KEY. Mapping: sexual -> adultScore, violence ->
 *    violenceScore (severity 0-7 -> /7); no face detection.
 * Both throw an honest not-configured error so the chain skips them.
 */

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

export const MODERATION_TIMEOUT_MS_DEFAULT = 8_000;

export function moderationTimeoutMs(): number {
  const raw = Number(process.env.MODERATION_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 500 && raw <= 60_000
    ? raw
    : MODERATION_TIMEOUT_MS_DEFAULT;
}

function clamp01(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : null;
}

function requireBuffer(input: ModerationInput, provider: string): Buffer {
  if (!input.buffer) {
    throw new Error(`${provider} adapter needs image bytes (private bucket - no public URL)`);
  }
  return input.buffer;
}

// ---------------------------------------------------------------------------
// OpenAI moderation (omni-moderation-latest) - plain REST, no SDK
// ---------------------------------------------------------------------------

type OpenAiModerationResponse = {
  results?: Array<{
    flagged?: boolean;
    categories?: Record<string, boolean>;
    category_scores?: Record<string, number>;
  }>;
};

/**
 * OPENAI_API_KEY. Image sent as a data: URL. Category mapping:
 *  sexual, sexual/minors        -> adultScore / minorRiskScore
 *  violence, violence/graphic   -> violenceScore
 * The API does not detect faces or duplicates - those stay null.
 */
export const openAiModerationProvider: ModerationProvider = {
  name: "openai",
  async analyze(input): Promise<ModerationVerdict> {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) throw new Error("openai adapter selected but OPENAI_API_KEY is not set");
    const buffer = requireBuffer(input, "openai");

    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "omni-moderation-latest",
        input: [
          {
            type: "image_url",
            image_url: { url: `data:image/webp;base64,${buffer.toString("base64")}` },
          },
        ],
      }),
      signal: AbortSignal.timeout(moderationTimeoutMs()),
    });
    if (!res.ok) throw new Error(`openai moderation responded ${res.status}`);
    const raw = (await res.json()) as OpenAiModerationResponse;
    const result = raw.results?.[0];
    if (!result) throw new Error("openai moderation returned no results");

    const scoresIn = result.category_scores ?? {};
    const adult = clamp01(scoresIn["sexual"]);
    const minors = clamp01(scoresIn["sexual/minors"]);
    const violence = Math.max(
      clamp01(scoresIn["violence"]) ?? 0,
      clamp01(scoresIn["violence/graphic"]) ?? 0,
    );
    const scores: ModerationScores = {
      ...NULL_SCORES,
      adultScore: adult,
      minorRiskScore: minors,
      violenceScore: scoresIn["violence"] !== undefined || scoresIn["violence/graphic"] !== undefined ? violence : null,
      confidence: adult ?? minors ?? null,
    };
    const labels = Object.entries(result.categories ?? {})
      .filter(([, flagged]) => flagged === true)
      .map(([name]) => name);
    const decision: ModerationDecision = result.flagged ? "review" : "safe";
    const top = Math.max(adult ?? 0, minors ?? 0, violence);

    return {
      decision,
      aiScore: labels.length > 0 || adult !== null ? top : null,
      faceDetected: null, // OpenAI moderation does not do face detection
      facesCount: null,
      labels: labels.length > 0 ? labels : ["openai:clean"],
      reason: result.flagged ? `openai flagged: ${labels.join(", ")}` : "openai: no categories flagged",
      scores,
      providerReference: null,
    };
  },
};

// ---------------------------------------------------------------------------
// Google Vision SafeSearch + face detection - clean keyed REST
// ---------------------------------------------------------------------------

const LIKELIHOOD_SCORE: Record<string, number> = {
  VERY_UNLIKELY: 0.05,
  UNLIKELY: 0.2,
  POSSIBLE: 0.5,
  LIKELY: 0.75,
  VERY_LIKELY: 0.95,
};

type GoogleVisionResponse = {
  responses?: Array<{
    safeSearchAnnotation?: {
      adult?: string;
      violence?: string;
      racy?: string;
      medical?: string;
      spoof?: string;
    };
    faceAnnotations?: Array<unknown>;
    error?: { message?: string };
  }>;
};

/**
 * GOOGLE_VISION_API_KEY. SafeSearch likelihood buckets map onto 0-1
 * midpoints (VERY_UNLIKELY 0.05 ... VERY_LIKELY 0.95); adult|racy ->
 * adultScore (max), violence -> violenceScore. FACE_DETECTION supplies
 * faceDetected/facesCount. SafeSearch has no minors category -
 * minorRiskScore stays null (never invented).
 */
export const googleVisionProvider: ModerationProvider = {
  name: "google_vision",
  async analyze(input): Promise<ModerationVerdict> {
    const key = process.env.GOOGLE_VISION_API_KEY?.trim();
    if (!key) throw new Error("google_vision adapter selected but GOOGLE_VISION_API_KEY is not set");
    const buffer = requireBuffer(input, "google_vision");

    const res = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            {
              image: { content: buffer.toString("base64") },
              features: [
                { type: "SAFE_SEARCH_DETECTION" },
                { type: "FACE_DETECTION", maxResults: 10 },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(moderationTimeoutMs()),
      },
    );
    if (!res.ok) throw new Error(`google vision responded ${res.status}`);
    const raw = (await res.json()) as GoogleVisionResponse;
    const body = raw.responses?.[0];
    if (!body) throw new Error("google vision returned no responses");
    if (body.error?.message) throw new Error(`google vision error: ${body.error.message}`);

    const safe = body.safeSearchAnnotation;
    if (!safe) throw new Error("google vision returned no safeSearchAnnotation");
    const score = (likelihood?: string) =>
      likelihood !== undefined ? (LIKELIHOOD_SCORE[likelihood] ?? null) : null;
    const adult = score(safe.adult);
    const racy = score(safe.racy);
    const violence = score(safe.violence);
    const adultScore = adult !== null || racy !== null ? Math.max(adult ?? 0, racy ?? 0) : null;

    const faces = Array.isArray(body.faceAnnotations) ? body.faceAnnotations.length : 0;
    const labels: string[] = [];
    if ((adult ?? 0) >= 0.75) labels.push("adult");
    if ((racy ?? 0) >= 0.75) labels.push("racy");
    if ((violence ?? 0) >= 0.75) labels.push("violence");
    if (faces === 0) labels.push("no-face");
    if (faces > 1) labels.push("multiple-faces");

    return {
      decision: "safe", // thresholds in decidePhotoSafety decide from scores
      aiScore: adultScore,
      faceDetected: faces > 0,
      facesCount: faces,
      labels: labels.length > 0 ? labels : ["google_vision:clean"],
      reason: `google vision safe-search adult=${safe.adult ?? "?"} violence=${safe.violence ?? "?"} racy=${safe.racy ?? "?"}`,
      scores: {
        ...NULL_SCORES,
        adultScore,
        violenceScore: violence,
        confidence: adultScore ?? violence ?? null,
      },
      providerReference: null,
    };
  },
};

// ---------------------------------------------------------------------------
// Hive AI visual moderation - keyed REST (v2 sync task)
// ---------------------------------------------------------------------------

type HiveResponse = {
  status?: Array<{
    response?: {
      output?: Array<{ classes?: Array<{ class?: string; score?: number }> }>;
    };
  }>;
  task_id?: string;
};

/** Hive class-name fragments -> our score fields (max wins per field). */
const HIVE_CLASS_MAP: Array<{ match: RegExp; field: keyof ModerationScores }> = [
  { match: /general_nsfw|yes_sexual_activity|yes_nudity|suggestive/i, field: "adultScore" },
  { match: /violence|gore|blood|weapon|gun|knife/i, field: "violenceScore" },
  { match: /child|minor|underage/i, field: "minorRiskScore" },
  { match: /animated|ai_generated|synthetic|deepfake/i, field: "aiGeneratedScore" },
];

/**
 * HIVE_API_KEY - POST https://api.thehive.ai/api/v2/task/sync with the
 * image as multipart "media". Class scores map through HIVE_CLASS_MAP;
 * classes Hive does not return stay null.
 */
export const hiveModerationProvider: ModerationProvider = {
  name: "hive",
  async analyze(input): Promise<ModerationVerdict> {
    const key = process.env.HIVE_API_KEY?.trim();
    if (!key) throw new Error("hive adapter selected but HIVE_API_KEY is not set");
    const buffer = requireBuffer(input, "hive");

    const form = new FormData();
    form.append(
      "media",
      new Blob([new Uint8Array(buffer)], { type: "image/webp" }),
      "photo.webp",
    );
    const res = await fetch("https://api.thehive.ai/api/v2/task/sync", {
      method: "POST",
      headers: { Authorization: `Token ${key}` },
      body: form,
      signal: AbortSignal.timeout(moderationTimeoutMs()),
    });
    if (!res.ok) throw new Error(`hive responded ${res.status}`);
    const raw = (await res.json()) as HiveResponse;
    const classes = raw.status?.[0]?.response?.output?.[0]?.classes;
    if (!Array.isArray(classes)) throw new Error("hive returned no classes");

    const scores: ModerationScores = { ...NULL_SCORES };
    const labels: string[] = [];
    for (const entry of classes) {
      if (typeof entry.class !== "string") continue;
      const value = clamp01(entry.score);
      if (value === null) continue;
      for (const { match, field } of HIVE_CLASS_MAP) {
        if (match.test(entry.class) && field !== "confidence") {
          if (value > (scores[field] ?? 0)) scores[field] = value;
          if (value >= 0.6) labels.push(entry.class);
        }
      }
    }
    scores.confidence =
      scores.adultScore ?? scores.minorRiskScore ?? scores.violenceScore ?? null;
    const top = Math.max(
      scores.adultScore ?? 0,
      scores.violenceScore ?? 0,
      scores.minorRiskScore ?? 0,
      scores.aiGeneratedScore ?? 0,
    );

    return {
      decision: "safe", // thresholds decide
      aiScore: scores.confidence !== null ? top : null,
      faceDetected: null, // the moderation task does not report faces
      facesCount: null,
      labels: labels.length > 0 ? [...new Set(labels)] : ["hive:clean"],
      reason: `hive classes mapped (${classes.length} returned)`,
      scores,
      providerReference: typeof raw.task_id === "string" ? raw.task_id : null,
    };
  },
};

// ---------------------------------------------------------------------------
// Documented stubs - honest throw so the chain skips them
// ---------------------------------------------------------------------------

export const awsRekognitionProvider: ModerationProvider = {
  name: "aws_rekognition",
  async analyze(): Promise<ModerationVerdict> {
    throw new Error(
      "aws_rekognition is a documented stub (needs SigV4 signing - see the mapping doc at the top of moderation-providers.ts)",
    );
  },
};

export const azureContentSafetyProvider: ModerationProvider = {
  name: "azure",
  async analyze(): Promise<ModerationVerdict> {
    throw new Error(
      "azure is a documented stub (see the mapping doc at the top of moderation-providers.ts)",
    );
  },
};

// ---------------------------------------------------------------------------
// Provider health (ProviderHealth rows - admin read model)
// ---------------------------------------------------------------------------

export async function recordProviderSuccess(provider: string, now: Date = new Date()): Promise<void> {
  try {
    await db.providerHealth.upsert({
      where: { provider },
      create: { provider, totalSuccesses: 1, lastSuccessAt: now },
      update: {
        consecutiveFailures: 0,
        totalSuccesses: { increment: 1 },
        lastSuccessAt: now,
      },
    });
  } catch (error) {
    console.warn(`[moderation:health] success record failed for ${provider}:`, error);
  }
}

export async function recordProviderFailure(
  provider: string,
  message: string,
  now: Date = new Date(),
): Promise<void> {
  try {
    await db.providerHealth.upsert({
      where: { provider },
      create: {
        provider,
        consecutiveFailures: 1,
        totalFailures: 1,
        lastError: message.slice(0, 500),
        lastErrorAt: now,
      },
      update: {
        consecutiveFailures: { increment: 1 },
        totalFailures: { increment: 1 },
        lastError: message.slice(0, 500),
        lastErrorAt: now,
      },
    });
  } catch (error) {
    console.warn(`[moderation:health] failure record failed for ${provider}:`, error);
  }
}

// ---------------------------------------------------------------------------
// Fallback chain
// ---------------------------------------------------------------------------

export type ChainAttempt = { provider: string; error: string };

export class ModerationChainError extends Error {
  constructor(readonly attempts: ChainAttempt[]) {
    super(
      `all moderation providers failed: ${attempts.map((a) => `${a.provider} (${a.error})`).join("; ")}`,
    );
    this.name = "ModerationChainError";
  }
}

/**
 * Build a provider that tries `providers` in order. Success = the verdict
 * of the FIRST provider that answers (plus a health success record);
 * every failure records health and falls through. All failed -> throws
 * ModerationChainError, which moderatePhoto turns into the FAILED /
 * needs_review path - never an approval. Exported so tests can compose
 * spy providers with induced timeouts.
 */
export function buildModerationChain(providers: ModerationProvider[]): ModerationProvider {
  return {
    name: `chain(${providers.map((p) => p.name).join(",")})`,
    async analyze(input, context): Promise<ModerationVerdict> {
      const attempts: ChainAttempt[] = [];
      for (const provider of providers) {
        try {
          const verdict = await provider.analyze(input, context);
          await recordProviderSuccess(provider.name);
          return verdict;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          attempts.push({ provider: provider.name, error: message });
          await recordProviderFailure(provider.name, message);
          console.warn(
            `[moderation:chain] provider "${provider.name}" failed (${message}) - trying next`,
          );
        }
      }
      throw new ModerationChainError(attempts);
    },
  };
}

const ADAPTERS: Record<string, ModerationProvider> = {
  openai: openAiModerationProvider,
  google_vision: googleVisionProvider,
  hive: hiveModerationProvider,
  aws_rekognition: awsRekognitionProvider,
  azure: azureContentSafetyProvider,
};

/** Env presence check per adapter - unconfigured names are skipped. */
function adapterConfigured(name: string): boolean {
  switch (name) {
    case "openai":
      return !!process.env.OPENAI_API_KEY?.trim();
    case "google_vision":
      return !!process.env.GOOGLE_VISION_API_KEY?.trim();
    case "hive":
      return !!process.env.HIVE_API_KEY?.trim();
    case "external":
      return !!process.env.MODERATION_API_URL && !!process.env.MODERATION_API_KEY;
    default:
      return false; // stubs never count as configured
  }
}

/**
 * Resolve MODERATION_PROVIDERS ("openai,google_vision,hive,external") into
 * the ordered, CONFIGURED adapter list. Unknown names and adapters missing
 * their env are skipped with a log line; an empty result means "no real
 * provider" and the caller falls back per pickProvider's rules.
 * `external` refers to the generic adapter in moderation.ts (injected by
 * the caller to avoid a circular import).
 */
export function resolveConfiguredProviders(
  externalProvider: ModerationProvider,
): ModerationProvider[] {
  const list = (process.env.MODERATION_PROVIDERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const providers: ModerationProvider[] = [];
  for (const name of list) {
    const adapter = name === "external" ? externalProvider : ADAPTERS[name];
    if (!adapter) {
      console.warn(`[moderation:chain] unknown provider "${name}" in MODERATION_PROVIDERS - skipped`);
      continue;
    }
    if (!adapterConfigured(name)) {
      console.warn(`[moderation:chain] provider "${name}" is not configured (missing env) - skipped`);
      continue;
    }
    providers.push(adapter);
  }
  return providers;
}
