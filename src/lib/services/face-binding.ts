import { db } from "@/lib/db";
import type { FaceBindingStatus, FaceBindingMethod } from "@/generated/prisma/enums";
import { recordVerificationAudit } from "@/lib/services/face-verification";

/**
 * Epic 2 - the pluggable Face Binding Platform (abstraction ONLY).
 *
 * It owns the FaceIdentityBinding lifecycle: the identity<->liveness binding
 * whose BOUND status is the one gate that flips evaluatePhotoGrant() from
 * NO_BINDING to ELIGIBLE. This module owns the CONTRACT, the canonical
 * states/events, the transition rules, the registry and the engine facade.
 *
 * Two ways a binding reaches BOUND:
 *   1. AUTOMATED provider (createBinding returns BOUND directly): TEST-ONLY -
 *      only the FakeBindingProvider does this; no automated production provider
 *      returns BOUND.
 *   2. HUMAN REVIEW (completeReview("BOUND")): PRODUCTION - a registered
 *      HUMAN_REVIEW provider (human-review-binding.ts) routes a binding to
 *      MANUAL_REVIEW, and an authorized reviewer completes it to BOUND via
 *      POST /api/admin/verification/bindings/[id]/review. Gated by
 *      humanReviewConfigured() (config + binding legal gate), NOT by absent code.
 * Business logic here NEVER names Stripe / AWS / Persona.
 *
 * Server-only (imports @/lib/db); never pulled into a client bundle.
 */

// ------------------------------------------------------------- states
// ONE canonical status enum - reused from the Prisma schema (Epic 1). No
// duplicate string unions anywhere.
export type { FaceBindingStatus, FaceBindingMethod } from "@/generated/prisma/enums";

export const BINDING_STATUS = {
  NOT_BOUND: "NOT_BOUND",
  BINDING_REQUIRED: "BINDING_REQUIRED",
  BINDING_IN_PROGRESS: "BINDING_IN_PROGRESS",
  BOUND: "BOUND",
  BINDING_FAILED: "BINDING_FAILED",
  MANUAL_REVIEW: "MANUAL_REVIEW",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  CONSENT_WITHDRAWN: "CONSENT_WITHDRAWN",
} as const satisfies Record<string, FaceBindingStatus>;

// ------------------------------------------------------------- events
// Canonical, provider-agnostic audit event names. No provider-specific events.
export const BindingEvent = {
  BindingRequested: "binding_requested",
  BindingStarted: "binding_started",
  BindingSucceeded: "binding_succeeded",
  BindingFailed: "binding_failed",
  BindingInvalidated: "binding_invalidated",
  BindingDeleted: "binding_deleted",
  BindingReviewRequested: "binding_review_requested",
  BindingReviewCompleted: "binding_review_completed",
} as const;
export type BindingEvent = (typeof BindingEvent)[keyof typeof BindingEvent];

// -------------------------------------------------- provider contract
/** Provider-agnostic inputs. Identifiers only - never images/templates. */
export type BindingContext = {
  userId: string;
  faceReferenceId: string | null;
  identityVerificationId?: string | null;
  identitySessionId?: string | null;
  livenessFlowId?: string | null;
};

/** Normalized provider result - a canonical status + evidence bands only. */
export type BindingOutcome = {
  status: FaceBindingStatus;
  similarityBand?: string | null;
  modelVersion?: string | null;
  thresholdVersion?: string | null;
  failureReasonCode?: string | null;
};

export type BindingHealth = { available: boolean; detail?: string };

/**
 * THE canonical provider interface. Every present or future binding method
 * (human review, an automated identity-selfie compare, a combined native
 * provider) implements exactly this. Business logic depends only on this
 * interface - never on a concrete vendor.
 */
export interface FaceBindingProvider {
  readonly method: FaceBindingMethod;
  createBinding(ctx: BindingContext): Promise<BindingOutcome>;
  getBinding(ctx: BindingContext): Promise<BindingOutcome | null>;
  refreshBinding(ctx: BindingContext): Promise<BindingOutcome>;
  invalidateBinding(ctx: BindingContext): Promise<void>;
  deleteBinding(ctx: BindingContext): Promise<void>;
  health(): Promise<BindingHealth>;
}

// ------------------------------------------------------------ registry
// Registry selection: the three real methods plus UNKNOWN (nothing selected).
export type BindingMethodSelection = FaceBindingMethod | "UNKNOWN";

const providerOverrides = new Map<FaceBindingMethod, FaceBindingProvider>();

/** TEST SEAM: register a provider (only the FakeBindingProvider in tests). */
export function setBindingProviderOverride(
  method: FaceBindingMethod,
  provider: FaceBindingProvider | null,
): void {
  if (provider) providerOverrides.set(method, provider);
  else providerOverrides.delete(method);
}

/** TEST SEAM: clear all registered providers. */
export function resetBindingProviders(): void {
  providerOverrides.clear();
}

// Production registration: a real provider module self-registers a FACTORY
// that returns its singleton ONLY when the method is configured + approved,
// and null otherwise. Registering a factory is NOT enabling a provider - it
// stays dormant until the factory's own config gate passes.
type BindingProviderFactory = () => FaceBindingProvider | null;
const productionFactories = new Map<FaceBindingMethod, BindingProviderFactory>();

export function registerBindingProviderFactory(
  method: FaceBindingMethod,
  factory: BindingProviderFactory,
): void {
  productionFactories.set(method, factory);
}

/**
 * Resolve the configured method from env (FACE_BINDING_METHOD). Dormant by
 * default: unset / unrecognized -> UNKNOWN. Accepts a friendly alias
 * (STRIPE_COMPARE) for the schema's STRIPE_SELFIE_COMPARE.
 */
export function bindingMethodFromEnv(): BindingMethodSelection {
  const raw = process.env.FACE_BINDING_METHOD?.trim().toUpperCase();
  switch (raw) {
    case "HUMAN_REVIEW":
      return "HUMAN_REVIEW";
    case "PROVIDER_NATIVE":
      return "PROVIDER_NATIVE";
    case "STRIPE_COMPARE":
    case "STRIPE_SELFIE_COMPARE":
      return "STRIPE_SELFIE_COMPARE";
    default:
      return "UNKNOWN";
  }
}

/**
 * Select the provider for a method. Resolution order: a test override, then a
 * registered production factory (which itself returns null unless configured +
 * approved). Dormant by default: no override, no factory (or an unconfigured
 * factory) -> null -> the engine returns NOT_IMPLEMENTED.
 */
export function getBindingProvider(method: BindingMethodSelection): FaceBindingProvider | null {
  if (method === "UNKNOWN") return null;
  const override = providerOverrides.get(method);
  if (override) return override;
  const factory = productionFactories.get(method);
  return factory ? factory() : null;
}

// -------------------------------------------------------- transitions
// ONE canonical transition table (Phase 6). Any transition not listed is
// illegal and refused. Rotation/withdrawal can reach NOT_BOUND from anywhere.
const ALLOWED: Record<FaceBindingStatus, FaceBindingStatus[]> = {
  NOT_BOUND: ["BINDING_REQUIRED"],
  BINDING_REQUIRED: ["BINDING_IN_PROGRESS", "CONSENT_WITHDRAWN", "NOT_BOUND"],
  BINDING_IN_PROGRESS: [
    "BOUND",
    "MANUAL_REVIEW",
    "BINDING_FAILED",
    "PROVIDER_UNAVAILABLE",
    "CONSENT_WITHDRAWN",
    "NOT_BOUND",
  ],
  BOUND: ["CONSENT_WITHDRAWN", "NOT_BOUND"],
  MANUAL_REVIEW: ["BOUND", "BINDING_FAILED", "CONSENT_WITHDRAWN", "NOT_BOUND"],
  BINDING_FAILED: ["BINDING_REQUIRED", "CONSENT_WITHDRAWN", "NOT_BOUND"],
  PROVIDER_UNAVAILABLE: [
    "BINDING_REQUIRED",
    "BINDING_IN_PROGRESS",
    "CONSENT_WITHDRAWN",
    "NOT_BOUND",
  ],
  CONSENT_WITHDRAWN: ["NOT_BOUND", "BINDING_REQUIRED"],
};

export function canTransition(from: FaceBindingStatus, to: FaceBindingStatus): boolean {
  if (from === to) return true; // idempotent re-assert
  return (ALLOWED[from] ?? []).includes(to);
}

export class IllegalBindingTransitionError extends Error {
  constructor(
    public readonly from: FaceBindingStatus,
    public readonly to: FaceBindingStatus,
  ) {
    super(`Illegal binding transition ${from} -> ${to}`);
    this.name = "IllegalBindingTransitionError";
  }
}

// ------------------------------------------------------------- engine
export type EngineCode =
  "OK" | "NOT_IMPLEMENTED" | "PROVIDER_UNAVAILABLE" | "NOT_FOUND" | "ILLEGAL_TRANSITION";

export type EngineResult = {
  code: EngineCode;
  status: FaceBindingStatus | null;
  bindingId: string | null;
};

function providerLabel(method: FaceBindingMethod): string {
  return method.toLowerCase();
}

async function auditBinding(
  userId: string,
  event: BindingEvent,
  bindingId: string,
  method: FaceBindingMethod,
  from: FaceBindingStatus,
  to: FaceBindingStatus,
  reasonCode?: string | null,
): Promise<void> {
  // No PII: bindingId (cuid), method + statuses (enums), reason code only.
  await recordVerificationAudit({
    userId,
    eventType: event,
    actorType: "system",
    previousStatus: from,
    newStatus: to,
    reasonCode: reasonCode ?? null,
    metadata: { bindingId, method },
  });
}

/**
 * Apply a VALIDATED status transition to a binding row + audit it. Refuses
 * illegal transitions (throws) - the single place transitions are enforced.
 */
async function transition(
  binding: { id: string; userId: string; method: FaceBindingMethod; status: FaceBindingStatus },
  to: FaceBindingStatus,
  event: BindingEvent,
  outcome?: BindingOutcome,
): Promise<void> {
  if (!canTransition(binding.status, to)) {
    throw new IllegalBindingTransitionError(binding.status, to);
  }
  await db.faceIdentityBinding.update({
    where: { id: binding.id },
    data: {
      status: to,
      similarityBand: outcome?.similarityBand ?? undefined,
      modelVersion: outcome?.modelVersion ?? undefined,
      thresholdVersion: outcome?.thresholdVersion ?? undefined,
      failureReasonCode: outcome?.failureReasonCode ?? undefined,
      boundAt: to === "BOUND" ? new Date() : undefined,
    },
  });
  await auditBinding(
    binding.userId,
    event,
    binding.id,
    binding.method,
    binding.status,
    to,
    outcome?.failureReasonCode,
  );
  binding.status = to; // keep the in-memory copy consistent for chained calls
}

const eventForStatus: Partial<Record<FaceBindingStatus, BindingEvent>> = {
  BOUND: BindingEvent.BindingSucceeded,
  BINDING_FAILED: BindingEvent.BindingFailed,
  MANUAL_REVIEW: BindingEvent.BindingReviewRequested,
  PROVIDER_UNAVAILABLE: BindingEvent.BindingFailed,
};

/**
 * THE single API future workers use. Workers ask the engine; they never touch
 * a provider, a registry, or a vendor SDK. Nothing binds anyone in this Epic:
 * with no registered provider the engine returns NOT_IMPLEMENTED.
 */
export const FaceBindingEngine = {
  /** NOT_BOUND -> BINDING_REQUIRED: create the binding request row. */
  async requestBinding(ctx: BindingContext, method: FaceBindingMethod): Promise<EngineResult> {
    const binding = await db.faceIdentityBinding.create({
      data: {
        userId: ctx.userId,
        faceReferenceId: ctx.faceReferenceId,
        identityVerificationId: ctx.identityVerificationId ?? null,
        identitySessionId: ctx.identitySessionId ?? null,
        livenessFlowId: ctx.livenessFlowId ?? null,
        method,
        provider: providerLabel(method),
        status: BINDING_STATUS.BINDING_REQUIRED,
      },
    });
    await auditBinding(
      ctx.userId,
      BindingEvent.BindingRequested,
      binding.id,
      method,
      BINDING_STATUS.NOT_BOUND,
      BINDING_STATUS.BINDING_REQUIRED,
    );
    return { code: "OK", status: BINDING_STATUS.BINDING_REQUIRED, bindingId: binding.id };
  },

  /**
   * Advance a requested binding through its provider. Selects the provider via
   * the registry; if none is registered (production/dormant) returns
   * NOT_IMPLEMENTED and does NOT advance. With a provider (tests only) it runs
   * BINDING_IN_PROGRESS -> {BOUND|MANUAL_REVIEW|BINDING_FAILED|PROVIDER_UNAVAILABLE}.
   */
  async processBinding(bindingId: string): Promise<EngineResult> {
    const binding = await db.faceIdentityBinding.findUnique({ where: { id: bindingId } });
    if (!binding) return { code: "NOT_FOUND", status: null, bindingId };

    const provider = getBindingProvider(binding.method);
    if (!provider) {
      // Dormant: no provider implemented. Do not bind anyone.
      return { code: "NOT_IMPLEMENTED", status: binding.status, bindingId };
    }

    try {
      await transition(binding, BINDING_STATUS.BINDING_IN_PROGRESS, BindingEvent.BindingStarted);
      const health = await provider.health();
      if (!health.available) {
        await transition(binding, BINDING_STATUS.PROVIDER_UNAVAILABLE, BindingEvent.BindingFailed);
        return {
          code: "PROVIDER_UNAVAILABLE",
          status: BINDING_STATUS.PROVIDER_UNAVAILABLE,
          bindingId,
        };
      }
      const outcome = await provider.createBinding({
        userId: binding.userId,
        faceReferenceId: binding.faceReferenceId,
        identityVerificationId: binding.identityVerificationId,
        identitySessionId: binding.identitySessionId,
        livenessFlowId: binding.livenessFlowId,
      });
      const event = eventForStatus[outcome.status] ?? BindingEvent.BindingFailed;
      await transition(binding, outcome.status, event, outcome);
      return { code: "OK", status: outcome.status, bindingId };
    } catch (error) {
      if (error instanceof IllegalBindingTransitionError) {
        return { code: "ILLEGAL_TRANSITION", status: binding.status, bindingId };
      }
      throw error;
    }
  },

  /**
   * Withdrawal / rotation invalidation. Consent withdrawal -> CONSENT_WITHDRAWN;
   * reference rotation -> NOT_BOUND. Applied to every non-terminal binding of
   * the user. A binding that can never leave BOUND without this is exactly why
   * rotation must call it (a rotated reference must lose its binding).
   */
  async invalidateBinding(
    userId: string,
    reason: "consent_withdrawn" | "reference_rotated" | "reference_deleted",
  ): Promise<number> {
    const to: FaceBindingStatus =
      reason === "consent_withdrawn" ? BINDING_STATUS.CONSENT_WITHDRAWN : BINDING_STATUS.NOT_BOUND;
    const rows = await db.faceIdentityBinding.findMany({
      where: {
        userId,
        status: { notIn: [BINDING_STATUS.NOT_BOUND, BINDING_STATUS.CONSENT_WITHDRAWN] },
      },
    });
    let n = 0;
    for (const b of rows) {
      if (!canTransition(b.status, to)) continue;
      await transition(
        { id: b.id, userId: b.userId, method: b.method, status: b.status },
        to,
        BindingEvent.BindingInvalidated,
        { status: to, failureReasonCode: reason },
      );
      n += 1;
    }
    return n;
  },

  /** Complete a human/automated review: MANUAL_REVIEW -> BOUND | BINDING_FAILED. */
  async completeReview(
    bindingId: string,
    decision: Extract<FaceBindingStatus, "BOUND" | "BINDING_FAILED">,
    reviewer: { id: string; reasonCode?: string | null },
  ): Promise<EngineResult> {
    const binding = await db.faceIdentityBinding.findUnique({ where: { id: bindingId } });
    if (!binding) return { code: "NOT_FOUND", status: null, bindingId };
    // Idempotent: an already-decided binding re-asserts without a second write
    // or audit (safe double-submit / admin replay).
    if (binding.status === decision) return { code: "OK", status: decision, bindingId };
    // Validate BEFORE writing any review metadata - an illegal decision leaves
    // the binding (and reviewer fields) untouched.
    if (!canTransition(binding.status, decision)) {
      return { code: "ILLEGAL_TRANSITION", status: binding.status, bindingId };
    }
    // Atomic optimistic guard (Phase 13): only write if the binding is STILL in
    // the state we validated. Two simultaneous reviewers -> exactly one wins;
    // the loser sees the changed state and gets ILLEGAL_TRANSITION.
    const res = await db.faceIdentityBinding.updateMany({
      where: { id: bindingId, status: binding.status },
      data: {
        status: decision,
        reviewedById: reviewer.id,
        reviewedAt: new Date(),
        reviewReasonCode: reviewer.reasonCode ?? null,
        failureReasonCode: reviewer.reasonCode ?? undefined,
        boundAt: decision === "BOUND" ? new Date() : undefined,
      },
    });
    if (res.count === 0) {
      return { code: "ILLEGAL_TRANSITION", status: binding.status, bindingId };
    }
    await auditBinding(
      binding.userId,
      BindingEvent.BindingReviewCompleted,
      bindingId,
      binding.method,
      binding.status,
      decision,
      reviewer.reasonCode,
    );
    return { code: "OK", status: decision, bindingId };
  },

  /** Read the current binding state for a reference (workers/telemetry). */
  async getBinding(userId: string, faceReferenceId: string): Promise<FaceBindingStatus | null> {
    const b = await db.faceIdentityBinding.findFirst({
      where: { userId, faceReferenceId },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });
    return b?.status ?? null;
  },

  /** Hard delete + audit (account teardown). */
  async deleteBinding(bindingId: string): Promise<void> {
    const b = await db.faceIdentityBinding.findUnique({ where: { id: bindingId } });
    if (!b) return;
    await db.faceIdentityBinding.delete({ where: { id: bindingId } });
    await auditBinding(
      b.userId,
      BindingEvent.BindingDeleted,
      bindingId,
      b.method,
      b.status,
      BINDING_STATUS.NOT_BOUND,
    );
  },
};
