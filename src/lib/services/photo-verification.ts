import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

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
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "manual_review";

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

/**
 * Stripe Identity stub adapter. When the integration lands: createSession()
 * creates a VerificationSession (type "document" + selfie check) and returns
 * its client URL; getStatus() maps session.status; handleWebhook() verifies
 * the Stripe-Signature header with STRIPE_WEBHOOK_SECRET and maps
 * identity.verification_session.* events. Until the SDK calls are written it
 * throws the typed error so nothing fake ever runs - the route turns it
 * into an honest 503.
 */
const stripeIdentityProvider: PhotoVerificationProvider = makeProvider("stripe_identity", {
  async createSession(): Promise<VerificationStart> {
    throw new VerificationNotConfiguredError(
      "Stripe Identity is selected but the integration is not implemented yet.",
    );
  },
  async getStatus(): Promise<VerificationSessionStatus> {
    throw new VerificationNotConfiguredError(
      "Stripe Identity is selected but the integration is not implemented yet.",
    );
  },
  async handleWebhook(): Promise<VerificationWebhookEvent> {
    throw new VerificationWebhookError(
      "not_configured",
      "Stripe Identity webhooks are not implemented yet.",
    );
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
  if (which === "stripe_identity" && process.env.STRIPE_SECRET_KEY) return stripeIdentityProvider;
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
      data: { status: target, reviewNote: `provider:${providerName} webhook -> ${outcome}` },
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
      return row.reviewNote?.includes("final") ? "failed" : "retry_available";
    case "EXPIRED":
      return "retry_available";
  }
}
