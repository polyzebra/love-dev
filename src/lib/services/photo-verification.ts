import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { siteUrl } from "@/lib/auth/url";
import { verifyStripeSignature } from "@/lib/webhook-signatures";

/**
 * Photo verification - provider abstraction.
 *
 * PRIVACY CONTRACT: Tirvea never stores biometric data. Selfie/liveness
 * capture happens entirely on the provider's side; the only things we
 * persist are the provider's name, an opaque session id and the final
 * verdict (User.photoVerifiedAt + a Verification row). No images, no
 * face templates, no biometric derivatives - ever.
 *
 * Configuration (all server-side env):
 *   VERIFICATION_PROVIDER = "stripe_identity" | "persona" | "mock"
 *   - stripe_identity additionally requires STRIPE_SECRET_KEY
 *   - persona additionally requires PERSONA_API_KEY (+ PERSONA_TEMPLATE_ID)
 *   - mock (dev/tests only) additionally requires
 *     VERIFICATION_WEBHOOK_SECRET for its signed webhooks
 * Anything else (or missing keys) resolves to the not-configured provider,
 * and callers surface an honest "coming soon" instead of a fake flow.
 *
 * Interface (spec shape): createSession(userId) / getStatus(sessionId) /
 * handleWebhook(payload). `start`/`status` remain as back-compat aliases
 * for the pre-existing /api/verification/photo/start route.
 */

export type VerificationSessionStatus =
  "pending" | "approved" | "rejected" | "expired" | "manual_review";

export type VerificationStart = {
  /** Opaque session reference on the provider side. */
  sessionId: string;
  /** Hosted flow URL to redirect the user to, when the provider has one. */
  url?: string;
};

export type VerificationWebhookInput = {
  /** Raw request body EXACTLY as received (signature base). */
  rawBody: string;
  /** Signature header value (provider-specific header name; route maps it). */
  signature: string | null;
};

export type VerificationWebhookEvent = {
  sessionId: string;
  status: VerificationSessionStatus;
};

/** Typed error: webhook signature/shape failed verification. */
export class VerificationWebhookError extends Error {
  constructor(
    readonly code: "bad_signature" | "bad_payload" | "not_configured",
    message: string,
  ) {
    super(message);
    this.name = "VerificationWebhookError";
  }
}

export interface PhotoVerificationProvider {
  /** Persisted into User.photoVerificationProvider / Verification.provider. */
  readonly name: string;
  createSession(userId: string): Promise<VerificationStart>;
  getStatus(sessionId: string): Promise<VerificationSessionStatus>;
  /** Verify + parse one webhook delivery. Throws VerificationWebhookError. */
  handleWebhook(input: VerificationWebhookInput): Promise<VerificationWebhookEvent>;
  /** Back-compat aliases (existing route). */
  start(userId: string): Promise<VerificationStart>;
  status(sessionId: string): Promise<VerificationSessionStatus>;
}

/** Typed error: verification requested while no provider is wired up. */
export class VerificationNotConfiguredError extends Error {
  readonly code = "verification_not_configured";
  constructor(message = "Photo verification is not configured.") {
    super(message);
    this.name = "VerificationNotConfiguredError";
  }
}

/** Builds a full provider from the two core calls + a webhook handler. */
function makeProvider(
  name: string,
  impl: {
    createSession(userId: string): Promise<VerificationStart>;
    getStatus(sessionId: string): Promise<VerificationSessionStatus>;
    handleWebhook(input: VerificationWebhookInput): Promise<VerificationWebhookEvent>;
  },
): PhotoVerificationProvider {
  return {
    name,
    createSession: impl.createSession,
    getStatus: impl.getStatus,
    handleWebhook: impl.handleWebhook,
    start: impl.createSession,
    status: impl.getStatus,
  };
}

/** Default provider: refuses honestly instead of pretending to verify. */
export const notConfiguredProvider: PhotoVerificationProvider = makeProvider("none", {
  async createSession(): Promise<VerificationStart> {
    throw new VerificationNotConfiguredError();
  },
  async getStatus(): Promise<VerificationSessionStatus> {
    throw new VerificationNotConfiguredError();
  },
  async handleWebhook(): Promise<VerificationWebhookEvent> {
    throw new VerificationWebhookError(
      "not_configured",
      "No verification provider is configured - webhook rejected.",
    );
  },
});

// ---------------------------------------------------------------------------
// Stripe Identity - LIVE adapter. Fetch-based like lib/stripe.ts (the
// project deliberately carries no Stripe SDK); the transport is
// injectable so tests never touch the network. Signature verification
// reuses the shared Stripe scheme (webhook-signatures.ts) with a
// DEDICATED secret - never the billing webhook secret.
// ---------------------------------------------------------------------------

/** The slice of a Stripe Identity VerificationSession this adapter reads. */
export type StripeIdentitySession = {
  id: string;
  status: "requires_input" | "processing" | "verified" | "canceled";
  url?: string | null;
  last_error?: { code?: string | null } | null;
};

export type StripeIdentityTransport = (
  method: "GET" | "POST",
  path: string,
  params?: Record<string, string>,
) => Promise<StripeIdentitySession>;

let stripeIdentityTransportOverride: StripeIdentityTransport | null = null;

/** Test seam: inject a fake Stripe Identity transport (null restores). */
export function setStripeIdentityTransport(transport: StripeIdentityTransport | null): void {
  stripeIdentityTransportOverride = transport;
}

function stripeIdentityConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY?.trim() && process.env.STRIPE_IDENTITY_WEBHOOK_SECRET?.trim(),
  );
}

async function stripeIdentityRequest(
  method: "GET" | "POST",
  path: string,
  params?: Record<string, string>,
): Promise<StripeIdentitySession> {
  if (stripeIdentityTransportOverride) {
    return stripeIdentityTransportOverride(method, path, params);
  }
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new VerificationNotConfiguredError("STRIPE_SECRET_KEY is not set.");
  const body = method === "POST" && params ? new URLSearchParams(params).toString() : undefined;
  const query = method === "GET" && params ? `?${new URLSearchParams(params)}` : "";
  const res = await fetch(`https://api.stripe.com/v1${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body !== undefined ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as StripeIdentitySession & {
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(`Stripe Identity ${method} ${path} failed (${res.status})`);
  }
  return json;
}

/**
 * Stripe session -> Tirvea outcome vocabulary:
 *   verified              -> approved   (canonical stamp)
 *   processing            -> pending    (checks running - no-op)
 *   canceled              -> expired    (retry available)
 *   requires_input        -> rejected when last_error is present (the
 *                            attempt failed: consent declined, document
 *                            unreadable, selfie mismatch, ...);
 *                            otherwise pending (the user simply has not
 *                            finished the hosted flow - never a verdict)
 */
export function mapStripeIdentityStatus(
  session: Pick<StripeIdentitySession, "status" | "last_error">,
): VerificationSessionStatus {
  switch (session.status) {
    case "verified":
      return "approved";
    case "processing":
      return "pending";
    case "canceled":
      return "expired";
    case "requires_input":
      return session.last_error?.code ? "rejected" : "pending";
    default:
      // A Stripe API update could introduce states this build has never
      // seen. "pending" is the SAFE unknown: applyVerificationOutcome
      // no-ops on it, so nothing is invented until the code learns the
      // new state. Never a verdict from an unknown value.
      return "pending";
  }
}

/** Stripe Identity event types this adapter understands. */
const STRIPE_IDENTITY_EVENT_PREFIX = "identity.verification_session.";

const stripeIdentityProvider: PhotoVerificationProvider = makeProvider("stripe_identity", {
  async createSession(userId: string): Promise<VerificationStart> {
    if (!stripeIdentityConfigured()) {
      throw new VerificationNotConfiguredError(
        "Stripe Identity requires STRIPE_SECRET_KEY and STRIPE_IDENTITY_WEBHOOK_SECRET.",
      );
    }
    // Document + matching-selfie check, hosted entirely by Stripe. The
    // ONLY metadata is our internal user id (reconciliation) - never
    // email/phone/PII. Stripe holds the images; Tirvea stores the
    // session id and the outcome, nothing else (privacy promise).
    const session = await stripeIdentityRequest("POST", "/identity/verification_sessions", {
      type: "document",
      "options[document][require_matching_selfie]": "true",
      "options[document][require_live_capture]": "true",
      "metadata[tirvea_user_id]": userId,
      return_url: `${siteUrl()}/profile#photo-verification`,
    });
    return { sessionId: session.id, url: session.url ?? undefined };
  },
  async getStatus(sessionId: string): Promise<VerificationSessionStatus> {
    if (!stripeIdentityConfigured()) {
      throw new VerificationNotConfiguredError(
        "Stripe Identity requires STRIPE_SECRET_KEY and STRIPE_IDENTITY_WEBHOOK_SECRET.",
      );
    }
    const session = await stripeIdentityRequest(
      "GET",
      `/identity/verification_sessions/${encodeURIComponent(sessionId)}`,
    );
    return mapStripeIdentityStatus(session);
  },
  async handleWebhook(input: VerificationWebhookInput): Promise<VerificationWebhookEvent> {
    const secret = process.env.STRIPE_IDENTITY_WEBHOOK_SECRET?.trim();
    if (!secret) {
      throw new VerificationWebhookError(
        "not_configured",
        "STRIPE_IDENTITY_WEBHOOK_SECRET is not set - webhook rejected.",
      );
    }
    if (!input.signature || !verifyStripeSignature(input.rawBody, input.signature, secret)) {
      throw new VerificationWebhookError("bad_signature", "Stripe signature mismatch.");
    }
    let event: {
      type?: unknown;
      data?: { object?: StripeIdentitySession };
    };
    try {
      event = JSON.parse(input.rawBody) as typeof event;
    } catch {
      throw new VerificationWebhookError("bad_payload", "Webhook body is not valid JSON.");
    }
    const object = event.data?.object;
    // Unrelated event types (or identity events without a session object)
    // are acknowledged as a no-op: "pending" short-circuits in
    // applyVerificationOutcome before any lookup, so the route answers
    // 200 and nothing mutates. Never an error - Stripe must not retry-loop
    // on events we deliberately do not consume.
    if (
      typeof event.type !== "string" ||
      !event.type.startsWith(STRIPE_IDENTITY_EVENT_PREFIX) ||
      typeof object?.id !== "string"
    ) {
      return { sessionId: "ignored", status: "pending" };
    }
    return { sessionId: object.id, status: mapStripeIdentityStatus(object) };
  },
});

/**
 * Persona stub adapter. When the integration lands: createSession() creates
 * an inquiry from PERSONA_TEMPLATE_ID and returns its hosted-flow URL;
 * getStatus() maps inquiry.attributes.status; handleWebhook() verifies the
 * Persona-Signature HMAC with PERSONA_WEBHOOK_SECRET. Same honest-throw
 * until then.
 */
const personaProvider: PhotoVerificationProvider = makeProvider("persona", {
  async createSession(): Promise<VerificationStart> {
    throw new VerificationNotConfiguredError(
      "Persona is selected but the integration is not implemented yet.",
    );
  },
  async getStatus(): Promise<VerificationSessionStatus> {
    throw new VerificationNotConfiguredError(
      "Persona is selected but the integration is not implemented yet.",
    );
  },
  async handleWebhook(): Promise<VerificationWebhookEvent> {
    throw new VerificationWebhookError(
      "not_configured",
      "Persona webhooks are not implemented yet.",
    );
  },
});

// ---------------------------------------------------------------------------
// Mock provider (dev/tests) - real state machine, zero biometrics
// ---------------------------------------------------------------------------

const mockSessionStatus = new Map<string, VerificationSessionStatus>();

/** Test/dev hook: set what the mock provider reports for a session. */
export function setMockVerificationStatus(
  sessionId: string,
  status: VerificationSessionStatus,
): void {
  mockSessionStatus.set(sessionId, status);
}

export function mockWebhookSignature(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * MockVerificationProvider - selected ONLY when VERIFICATION_PROVIDER="mock".
 * Sessions are opaque uuids; status comes from the in-process map (default
 * "pending"); webhooks carry {"sessionId","status"} signed with an HMAC
 * SHA-256 of the raw body using VERIFICATION_WEBHOOK_SECRET (the same
 * signature pattern a real adapter implements). Nothing biometric exists
 * anywhere in this flow.
 */
export const mockVerificationProvider: PhotoVerificationProvider = makeProvider("mock", {
  async createSession(userId: string): Promise<VerificationStart> {
    const sessionId = `mock_${randomUUID()}`;
    mockSessionStatus.set(sessionId, "pending");
    void userId;
    return { sessionId };
  },
  async getStatus(sessionId: string): Promise<VerificationSessionStatus> {
    return mockSessionStatus.get(sessionId) ?? "pending";
  },
  async handleWebhook(input: VerificationWebhookInput): Promise<VerificationWebhookEvent> {
    const secret = process.env.VERIFICATION_WEBHOOK_SECRET?.trim();
    if (!secret) {
      throw new VerificationWebhookError(
        "not_configured",
        "VERIFICATION_WEBHOOK_SECRET is not set - mock webhooks rejected.",
      );
    }
    const expected = mockWebhookSignature(input.rawBody, secret);
    const given = input.signature ?? "";
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(given, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new VerificationWebhookError("bad_signature", "Webhook signature mismatch.");
    }
    let parsed: { sessionId?: unknown; status?: unknown };
    try {
      parsed = JSON.parse(input.rawBody) as { sessionId?: unknown; status?: unknown };
    } catch {
      throw new VerificationWebhookError("bad_payload", "Webhook body is not valid JSON.");
    }
    const statuses: VerificationSessionStatus[] = [
      "pending",
      "approved",
      "rejected",
      "expired",
      "manual_review",
    ];
    if (
      typeof parsed.sessionId !== "string" ||
      typeof parsed.status !== "string" ||
      !statuses.includes(parsed.status as VerificationSessionStatus)
    ) {
      throw new VerificationWebhookError("bad_payload", "Webhook payload shape is invalid.");
    }
    const status = parsed.status as VerificationSessionStatus;
    mockSessionStatus.set(parsed.sessionId, status);
    return { sessionId: parsed.sessionId, status };
  },
});

export function getPhotoVerificationProvider(): PhotoVerificationProvider {
  const which = process.env.VERIFICATION_PROVIDER?.trim().toLowerCase();
  if (which === "stripe_identity" && stripeIdentityConfigured()) return stripeIdentityProvider;
  if (which === "persona" && process.env.PERSONA_API_KEY) return personaProvider;
  // Mock is dev/test tooling - never silently active in production.
  if (which === "mock" && process.env.NODE_ENV !== "production") return mockVerificationProvider;
  return notConfiguredProvider;
}

export function isPhotoVerificationConfigured(): boolean {
  return getPhotoVerificationProvider() !== notConfiguredProvider;
}

// ---------------------------------------------------------------------------
// Outcome application (webhook / status poll) - idempotent, retry-safe
// ---------------------------------------------------------------------------

export type ApplyOutcomeResult =
  | { applied: true; userId: string; outcome: VerificationSessionStatus }
  | {
      applied: false;
      reason: "session_not_found" | "already_applied" | "no_op";
      userId: string | null;
    };

/**
 * Apply one provider outcome to the canonical stores, transactionally
 * (the reviewVerification-equivalent stamp):
 *   approved      -> Verification APPROVED + User.photoVerifiedAt stamped
 *   rejected      -> Verification REJECTED + photoVerifiedAt cleared
 *   expired       -> Verification EXPIRED (retry available)
 *   manual_review -> Verification IN_REVIEW
 *   pending       -> no-op (nothing to change)
 *
 * IDEMPOTENT by construction: the same webhook delivered twice finds the
 * row already in the target state and reports {applied:false,
 * reason:"already_applied"} without touching anything - retry-safe.
 * Only status + provider references are stored; never images/biometrics.
 */
export async function applyVerificationOutcome(
  providerName: string,
  sessionId: string,
  outcome: VerificationSessionStatus,
): Promise<ApplyOutcomeResult> {
  if (outcome === "pending") return { applied: false, reason: "no_op", userId: null };

  return db.$transaction(async (tx) => {
    const row = await tx.verification.findFirst({
      where: { type: "PHOTO", provider: providerName, providerSessionId: sessionId },
      select: { id: true, userId: true, status: true },
    });
    if (!row) return { applied: false, reason: "session_not_found" as const, userId: null };

    const target =
      outcome === "approved"
        ? "APPROVED"
        : outcome === "rejected"
          ? "REJECTED"
          : outcome === "expired"
            ? "EXPIRED"
            : "IN_REVIEW";
    if (row.status === target) {
      return { applied: false, reason: "already_applied" as const, userId: row.userId };
    }

    await tx.verification.update({
      where: { id: row.id },
      data: {
        status: target,
        statusChangedAt: new Date(),
        reviewNote: `provider:${providerName} webhook -> ${outcome}`,
      },
    });
    // The verdict lives on User.photoVerifiedAt (canon - verification.ts):
    // stamped/cleared atomically with the workflow row, exactly like the
    // admin reviewVerification action.
    if (outcome === "approved") {
      await tx.user.update({
        where: { id: row.userId },
        data: { photoVerifiedAt: new Date() },
      });
    } else if (outcome === "rejected") {
      await tx.user.update({
        where: { id: row.userId },
        data: { photoVerifiedAt: null },
      });
    }
    return { applied: true as const, userId: row.userId, outcome };
  });
}

// ---------------------------------------------------------------------------
// UX state (spec's state set) - derived, never a second stored verdict
// ---------------------------------------------------------------------------

export type VerificationUxState =
  | "not_verified"
  | "verification_started"
  | "pending"
  | "verified"
  | "failed"
  | "retry_available"
  | "manual_review";

/**
 * Poll-side completion of the verification loop (webhookless dev/mock
 * setups and "check status" taps): asks the configured provider for the
 * session's current status and applies it through the SAME idempotent
 * applyVerificationOutcome the webhook uses, including its side effects
 * (approved -> verified notification + PHOTO_REVIEW_REQUIRED lifted;
 * rejected -> safety notice). Then returns the fresh UX state. When no
 * provider is configured (or the row belongs to a different provider)
 * nothing is polled - the stored state is derived honestly.
 */
/** Default background-reconciliation throttle (override via env). */
export const VERIFICATION_RECONCILE_INTERVAL_MS = 5 * 60_000;

function reconcileIntervalMs(): number {
  const raw = Number(process.env.VERIFICATION_RECONCILE_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 30_000 ? raw : VERIFICATION_RECONCILE_INTERVAL_MS;
}

/**
 * Background reconciliation (webhook-loss recovery). Called from surfaces
 * that already load verification state: when the user's PHOTO row is
 * PENDING with a provider session and has not been reconciled within the
 * interval, poll the provider ONCE through the existing
 * syncPhotoVerificationState path (same idempotent applyVerificationOutcome
 * as the webhook - approved stamps the canonical verdict immediately).
 *
 *  - the throttle is an ATOMIC DB claim (updateMany WHERE stale): across
 *    every serverless instance at most one reconciliation per user per
 *    interval wins; losers return false without any provider call
 *  - verified users are excluded in the claim WHERE - a verified verdict
 *    is never re-polled, never downgraded here
 *  - silent by requirement: ANY failure (provider outage included) is
 *    swallowed - the stored state renders and the next interval retries
 * Returns true only when this call performed the reconciliation.
 */
export async function maybeReconcilePhotoVerification(
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    const provider = getPhotoVerificationProvider();
    if (provider === notConfiguredProvider) return false;
    const cutoff = new Date(now.getTime() - reconcileIntervalMs());
    const claimed = await db.verification.updateMany({
      where: {
        userId,
        type: "PHOTO",
        status: "PENDING",
        provider: provider.name,
        providerSessionId: { not: null },
        user: { photoVerifiedAt: null },
        OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lt: cutoff } }],
      },
      data: { lastReconciledAt: now },
    });
    if (claimed.count === 0) return false;
    await syncPhotoVerificationState(userId);
    return true;
  } catch {
    // Fail silently: reconciliation is a recovery path, never a feature
    // the user waits on. The claim already advanced lastReconciledAt, so
    // a flapping provider is polled at most once per interval.
    return false;
  }
}

export async function syncPhotoVerificationState(
  userId: string,
): Promise<{ state: VerificationUxState; configured: boolean }> {
  const provider = getPhotoVerificationProvider();
  const configured = provider !== notConfiguredProvider;

  const read = () =>
    db.user.findUnique({
      where: { id: userId },
      select: {
        photoVerifiedAt: true,
        verifications: {
          where: { type: "PHOTO" },
          select: { status: true, provider: true, providerSessionId: true, reviewNote: true },
          take: 1,
        },
      },
    });

  let user = await read();
  const row = user?.verifications[0] ?? null;

  if (
    configured &&
    user &&
    !user.photoVerifiedAt &&
    row?.status === "PENDING" &&
    row.providerSessionId &&
    row.provider === provider.name
  ) {
    try {
      const outcome = await provider.getStatus(row.providerSessionId);
      if (outcome !== "pending") {
        const result = await applyVerificationOutcome(
          provider.name,
          row.providerSessionId,
          outcome,
        );
        if (result.applied) {
          if (outcome === "approved") {
            const { notifyUser } = await import("@/lib/services/notify");
            await notifyUser({
              userId: result.userId,
              type: "PROFILE_VERIFIED",
              title: "You're verified!",
              body: "Your photo verification was approved. Your badge is now live.",
              dedupeKey: `verification:${row.providerSessionId}:approved`,
            });
            await db.user.updateMany({
              where: { id: result.userId, status: "PHOTO_REVIEW_REQUIRED" },
              data: { status: "ACTIVE" },
            });
          } else if (outcome === "rejected") {
            const { sendSafetyNotice } = await import("@/lib/services/safety-notices");
            await sendSafetyNotice(
              result.userId,
              "verification_rejected",
              `verification:${row.providerSessionId}:rejected`,
            );
          }
          user = await read();
        }
      }
    } catch {
      // Provider hiccups must not break the status read - fall through to
      // the stored state.
    }
  }

  const fresh = user?.verifications[0] ?? null;
  const state = deriveVerificationUxState({
    photoVerifiedAt: user?.photoVerifiedAt ?? null,
    verification: fresh
      ? {
          status: fresh.status,
          providerSessionId: fresh.providerSessionId,
          reviewNote: fresh.reviewNote,
        }
      : null,
  });
  return { state, configured };
}

/**
 * Derive the spec's UX state from the CANONICAL stores (User.photoVerifiedAt
 * verdict + the PHOTO Verification workflow row - see verification.ts).
 * Deliberately a pure mapper: no new columns, no second source of truth.
 *  - verified          photoVerifiedAt set
 *  - not_verified      no workflow row ever created
 *  - verification_started  row exists, session created, no provider result yet
 *  - pending           provider callback says still processing
 *  - manual_review     IN_REVIEW (a person is looking)
 *  - retry_available   REJECTED/EXPIRED - the user may start again
 *  - failed            REJECTED with reviewNote "final" (provider hard-fail)
 */
/**
 * TECH DEBT (documented, deliberate): whether a REJECTED verification is
 * FINAL (no retry offered) is inferred from the workflow row's reviewNote
 * containing the marker word "final". Today nothing writes that marker
 * automatically - only a staff member's manual review note can - so every
 * provider rejection is retryable by default, which matches the product
 * intent. A dedicated column/enum is the robust home for this bit; a
 * schema change is not worth it until a second writer needs it. This
 * helper is the ONE place the rule lives.
 */
export function isFinalRejection(reviewNote: string | null | undefined): boolean {
  return Boolean(reviewNote?.includes("final"));
}

export function deriveVerificationUxState(source: {
  photoVerifiedAt: Date | null;
  verification: {
    status: "PENDING" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "EXPIRED";
    providerSessionId: string | null;
    reviewNote: string | null;
  } | null;
}): VerificationUxState {
  if (source.photoVerifiedAt) return "verified";
  const row = source.verification;
  if (!row) return "not_verified";
  switch (row.status) {
    case "PENDING":
      return row.providerSessionId ? "pending" : "verification_started";
    case "IN_REVIEW":
      return "manual_review";
    case "APPROVED":
      // Row approved but the canonical stamp is missing - treat as pending
      // rather than inventing a verdict verification.ts does not hold.
      return "pending";
    case "REJECTED":
      return isFinalRejection(row.reviewNote) ? "failed" : "retry_available";
    case "EXPIRED":
      return "retry_available";
  }
}
