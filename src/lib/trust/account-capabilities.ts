import {
  canEngage,
  isDiscoverableStatus,
  isRestrictedStatus,
} from "@/lib/services/trust-safety";
import { registrationComplete, type GateUser } from "@/lib/auth/gate";

/**
 * THE canonical, server-owned capability resolver.
 *
 * ONE place answers "what may this authenticated user do right now, and if not,
 * WHY?". Every dating / discovery / messaging / realtime / notification /
 * premium / public-trust surface reads a decision off THIS object instead of
 * reconstructing it from scattered checks (user.status === "ACTIVE",
 * registrationComplete, canEngage, isPubliclyVerified, galleryVersion, ...).
 *
 * DESIGN: this module COMPOSES the existing canonical predicates - it never
 * forks them (canEngage / isDiscoverableStatus / isRestrictedStatus own their
 * domain; the badge stays behind the dispatcher; completion stays behind
 * registrationComplete). It PRESERVES every existing restriction, including the
 * deliberate divergences (chat-send = {ACTIVE, PHOTO_REVIEW_REQUIRED} vs
 * realtime-join = {ACTIVE, SHADOW_BANNED}; uploads exclude LIMITED/PHOTO_REVIEW).
 *
 * It returns MACHINE-READABLE denial reasons only - NEVER user-facing prose.
 * Presentation lives in a separate resolver (Phase H). Pure, deterministic,
 * side-effect free, React-free, fully unit-testable.
 */

export type AccountStateSummary =
  | "PENDING_REGISTRATION"
  | "PENDING_FACE_VERIFICATION" // FORWARD-COMPAT: inert (liveness gate reverted)
  | "ACTIVE" // ACTIVE, or PHOTO_REVIEW_REQUIRED (keeps engagement)
  | "LIMITED" // LIMITED / SHADOW_BANNED (registered, engagement withheld)
  | "SUSPENDED" // SUSPENDED / BANNED
  | "DEACTIVATED"
  | "DELETED"
  | "UNKNOWN"; // trust facts unavailable - fail closed

/** Typed, stable, safe-to-log denial reasons. No biometric / moderation detail. */
export type CapabilityDenialReason =
  | "ACCOUNT_DELETED"
  | "ACCOUNT_DEACTIVATED"
  | "ACCOUNT_SUSPENDED"
  | "TRUST_FACTS_UNAVAILABLE"
  | "REGISTRATION_INCOMPLETE"
  | "ACCOUNT_NOT_ACTIVE"
  | "FACE_VERIFICATION_REQUIRED"
  | "DISCOVERY_RESTRICTED"
  | "ENGAGEMENT_RESTRICTED"
  | "MESSAGING_RESTRICTED"
  | "REALTIME_RESTRICTED"
  | "ACCOUNT_LIMITED"
  | "ACCOUNT_SHADOW_BANNED"
  | "PROFILE_INCOMPLETE"
  | "PROFILE_HIDDEN"
  | "REALTIME_DISABLED"
  | "NOTIFICATIONS_DISABLED"
  | "PUSH_DISABLED"
  | "BILLING_RESTRICTED"
  | "PREMIUM_DISABLED"
  | "PREMIUM_REGION_UNSUPPORTED"
  | "PREMIUM_PROVIDER_UNAVAILABLE"
  | "NO_ACTIVE_ENTITLEMENT"
  | "ENTITLEMENT_EXPIRED"
  | "ENTITLEMENT_REVOKED"
  | "PUSH_PERMISSION_MISSING"
  | "DEVICE_SUBSCRIPTION_MISSING";

export type CapabilityDecision = {
  allowed: boolean;
  /** Precedence-ordered; [0] is the canonical PRIMARY reason. Empty iff allowed. */
  denialReasons: CapabilityDenialReason[];
};

export type AccountCapabilities = {
  accountState: AccountStateSummary;

  canEnterDating: CapabilityDecision;

  canAppearInDiscovery: CapabilityDecision;
  canAppearInExplore: CapabilityDecision;
  canAppearInSearch: CapabilityDecision;
  canBeRecommended: CapabilityDecision;
  canExposePublicProfile: CapabilityDecision;

  canSwipe: CapabilityDecision;
  canLike: CapabilityDecision;
  canSuperLike: CapabilityDecision;
  canUndoSwipe: CapabilityDecision;
  canCreateMatch: CapabilityDecision;
  canViewMatches: CapabilityDecision;

  canOpenChat: CapabilityDecision;
  canSendMessage: CapabilityDecision;
  canSendAttachment: CapabilityDecision;

  canJoinRealtime: CapabilityDecision;
  canReceiveRealtime: CapabilityDecision;

  canReceiveDatingNotifications: CapabilityDecision;
  canReceivePushNotifications: CapabilityDecision;

  canPurchasePremium: CapabilityDecision;
  canUsePremiumBenefits: CapabilityDecision;

  /** The public verified badge is a display flag, not a gated action. */
  publicBadgeVisible: boolean;
};

export type AccountCapabilityName = Exclude<
  keyof AccountCapabilities,
  "accountState" | "publicBadgeVisible"
>;

export type CapabilityFacts = {
  status: string;
  registrationComplete: boolean;
  onboardingDone: boolean;
  profileVisible: boolean;
  badgeVisible: boolean;
  /** False => every protected capability fails closed with TRUST_FACTS_UNAVAILABLE. */
  trustFactsAvailable?: boolean;
  // Forward-compat liveness gate (inert today - reverted).
  faceVerificationRequired?: boolean;
  faceVerified?: boolean;
  // Feature toggles / delivery signals - callers pass real values; safe
  // defaults preserve current behavior (everything enabled, no entitlement).
  realtimeEnabled?: boolean; // default true
  datingNotificationsEnabled?: boolean; // default true (category)
  billingEnabled?: boolean; // default true
  premiumEnabled?: boolean; // default true
  premiumRegionSupported?: boolean; // default true
  premiumProviderAvailable?: boolean; // default true
  entitlement?: "ACTIVE" | "EXPIRED" | "REVOKED" | "NONE"; // default NONE
  pushEnabled?: boolean; // default true
  pushPreferenceEnabled?: boolean; // default true
  pushPermissionGranted?: boolean; // default true
  deviceSubscription?: boolean; // default true
};

// ---- Deterministic precedence (Phase D) -----------------------------------
// The FIRST reason in this order is the canonical primary reason. Identical
// facts always yield identical ordering. No route may reorder this.
const PRECEDENCE: CapabilityDenialReason[] = [
  "ACCOUNT_DELETED",
  "ACCOUNT_DEACTIVATED",
  "ACCOUNT_SUSPENDED",
  "TRUST_FACTS_UNAVAILABLE",
  "REGISTRATION_INCOMPLETE",
  "ACCOUNT_NOT_ACTIVE",
  "FACE_VERIFICATION_REQUIRED",
  // feature-specific restriction
  "DISCOVERY_RESTRICTED",
  "ENGAGEMENT_RESTRICTED",
  "MESSAGING_RESTRICTED",
  "REALTIME_RESTRICTED",
  "ACCOUNT_LIMITED",
  "ACCOUNT_SHADOW_BANNED",
  "PROFILE_INCOMPLETE",
  "PROFILE_HIDDEN",
  // feature unavailable / disabled
  "REALTIME_DISABLED",
  "NOTIFICATIONS_DISABLED",
  "PUSH_DISABLED",
  "BILLING_RESTRICTED",
  "PREMIUM_DISABLED",
  "PREMIUM_REGION_UNSUPPORTED",
  "PREMIUM_PROVIDER_UNAVAILABLE",
  // missing prerequisite
  "NO_ACTIVE_ENTITLEMENT",
  "ENTITLEMENT_EXPIRED",
  "ENTITLEMENT_REVOKED",
  "PUSH_PERMISSION_MISSING",
  "DEVICE_SUBSCRIPTION_MISSING",
];
const RANK = new Map(PRECEDENCE.map((r, i) => [r, i]));

function decide(reasons: CapabilityDenialReason[]): CapabilityDecision {
  const sorted = [...new Set(reasons)].sort((a, b) => RANK.get(a)! - RANK.get(b)!);
  return { allowed: sorted.length === 0, denialReasons: sorted };
}

const REALTIME_STATUSES = new Set(["ACTIVE", "SHADOW_BANNED"]);

export function resolveAccountCapabilities(f: CapabilityFacts): AccountCapabilities {
  const faceRequired = f.faceVerificationRequired ?? false;
  const faceOk = f.faceVerified ?? true;
  const factsOk = f.trustFactsAvailable ?? true;

  // ---- account-level terminal reasons (precedence 1-7) ----
  const terminal: CapabilityDenialReason[] = [];
  if (!factsOk) terminal.push("TRUST_FACTS_UNAVAILABLE");
  else if (f.status === "DELETED") terminal.push("ACCOUNT_DELETED");
  else if (f.status === "DEACTIVATED") terminal.push("ACCOUNT_DEACTIVATED");
  else if (isRestrictedStatus(f.status)) terminal.push("ACCOUNT_SUSPENDED");
  else if (!f.registrationComplete) terminal.push("REGISTRATION_INCOMPLETE");
  else if (faceRequired && !faceOk) terminal.push("FACE_VERIFICATION_REQUIRED");

  const accountState: AccountStateSummary = !factsOk
    ? "UNKNOWN"
    : f.status === "DELETED"
      ? "DELETED"
      : f.status === "DEACTIVATED"
        ? "DEACTIVATED"
        : isRestrictedStatus(f.status)
          ? "SUSPENDED"
          : !f.registrationComplete
            ? "PENDING_REGISTRATION"
            : faceRequired && !faceOk
              ? "PENDING_FACE_VERIFICATION"
              : f.status === "LIMITED" || f.status === "SHADOW_BANNED"
                ? "LIMITED"
                : "ACTIVE";

  // If the account is terminally blocked, EVERY capability carries those
  // reasons - no restriction is ever silently dropped.
  if (terminal.length > 0) {
    const d = decide(terminal);
    const every = (): AccountCapabilities => ({
      accountState,
      canEnterDating: d,
      canAppearInDiscovery: d,
      canAppearInExplore: d,
      canAppearInSearch: d,
      canBeRecommended: d,
      canExposePublicProfile: d,
      canSwipe: d,
      canLike: d,
      canSuperLike: d,
      canUndoSwipe: d,
      canCreateMatch: d,
      canViewMatches: d,
      canOpenChat: d,
      canSendMessage: d,
      canSendAttachment: d,
      canJoinRealtime: d,
      canReceiveRealtime: d,
      canReceiveDatingNotifications: d,
      canReceivePushNotifications: d,
      canPurchasePremium: d,
      canUsePremiumBenefits: d,
      publicBadgeVisible: false,
    });
    return every();
  }

  // ---- usable account: feature-specific reasons (precedence 8-10) ----
  const statusEngageReason = (): CapabilityDenialReason =>
    f.status === "LIMITED"
      ? "ACCOUNT_LIMITED"
      : f.status === "SHADOW_BANNED"
        ? "ACCOUNT_SHADOW_BANNED"
        : "ENGAGEMENT_RESTRICTED";

  const engageReasons = canEngage(f.status) ? [] : [statusEngageReason()];
  const messageReasons = canEngage(f.status)
    ? []
    : [f.status === "LIMITED" || f.status === "SHADOW_BANNED" ? statusEngageReason() : "MESSAGING_RESTRICTED"];

  // discovery
  const discoveryReasons: CapabilityDenialReason[] = [];
  if (!isDiscoverableStatus(f.status)) {
    discoveryReasons.push(f.status === "SHADOW_BANNED" ? "ACCOUNT_SHADOW_BANNED" : "DISCOVERY_RESTRICTED");
  }
  if (!f.onboardingDone) discoveryReasons.push("PROFILE_INCOMPLETE");
  if (!f.profileVisible) discoveryReasons.push("PROFILE_HIDDEN");

  // uploads exclude LIMITED / PHOTO_REVIEW_REQUIRED (audit-preserved)
  const attachmentReasons: CapabilityDenialReason[] = [...messageReasons];
  if (canEngage(f.status) && f.status !== "ACTIVE") attachmentReasons.push("MESSAGING_RESTRICTED");

  // realtime
  const realtimeReasons: CapabilityDenialReason[] = [];
  if (f.realtimeEnabled === false) realtimeReasons.push("REALTIME_DISABLED");
  if (!REALTIME_STATUSES.has(f.status)) {
    realtimeReasons.push(f.status === "LIMITED" ? "ACCOUNT_LIMITED" : "REALTIME_RESTRICTED");
  }

  // notifications (dating category)
  const datingNotifReasons: CapabilityDenialReason[] = [];
  if (f.datingNotificationsEnabled === false) datingNotifReasons.push("NOTIFICATIONS_DISABLED");

  const pushReasons: CapabilityDenialReason[] = [...datingNotifReasons];
  if (f.pushEnabled === false || f.pushPreferenceEnabled === false) pushReasons.push("PUSH_DISABLED");
  if (f.pushPermissionGranted === false) pushReasons.push("PUSH_PERMISSION_MISSING");
  if (f.deviceSubscription === false) pushReasons.push("DEVICE_SUBSCRIPTION_MISSING");

  // premium purchase (account already usable - never a bypass)
  const purchaseReasons: CapabilityDenialReason[] = [];
  if (f.billingEnabled === false) purchaseReasons.push("BILLING_RESTRICTED");
  if (f.premiumEnabled === false) purchaseReasons.push("PREMIUM_DISABLED");
  if (f.premiumRegionSupported === false) purchaseReasons.push("PREMIUM_REGION_UNSUPPORTED");
  if (f.premiumProviderAvailable === false) purchaseReasons.push("PREMIUM_PROVIDER_UNAVAILABLE");

  // premium benefits: usable account + a live entitlement (separate from purchase)
  const entitlement = f.entitlement ?? "NONE";
  const benefitReasons: CapabilityDenialReason[] = [];
  if (f.premiumEnabled === false) benefitReasons.push("PREMIUM_DISABLED");
  if (entitlement === "NONE") benefitReasons.push("NO_ACTIVE_ENTITLEMENT");
  else if (entitlement === "EXPIRED") benefitReasons.push("ENTITLEMENT_EXPIRED");
  else if (entitlement === "REVOKED") benefitReasons.push("ENTITLEMENT_REVOKED");

  return {
    accountState,
    canEnterDating: decide([]),

    canAppearInDiscovery: decide(discoveryReasons),
    canAppearInExplore: decide(discoveryReasons),
    canAppearInSearch: decide(discoveryReasons),
    canBeRecommended: decide(discoveryReasons),
    canExposePublicProfile: decide(discoveryReasons),

    canSwipe: decide([]), // browsing + PASS
    canLike: decide(engageReasons),
    canSuperLike: decide(engageReasons),
    canUndoSwipe: decide(engageReasons),
    canCreateMatch: decide(engageReasons),
    canViewMatches: decide([]),

    canOpenChat: decide([]),
    canSendMessage: decide(messageReasons),
    canSendAttachment: decide(attachmentReasons),

    canJoinRealtime: decide(realtimeReasons),
    canReceiveRealtime: decide(realtimeReasons),

    canReceiveDatingNotifications: decide(datingNotifReasons),
    canReceivePushNotifications: decide(pushReasons),

    canPurchasePremium: decide(purchaseReasons),
    canUsePremiumBenefits: decide(benefitReasons),

    publicBadgeVisible: f.badgeVisible,
  };
}

// ---- narrow helpers (Phase C) ---------------------------------------------
export function isCapabilityAllowed(
  caps: AccountCapabilities,
  name: AccountCapabilityName,
): boolean {
  return caps[name].allowed;
}

export function getCapabilityDenialReasons(
  caps: AccountCapabilities,
  name: AccountCapabilityName,
): CapabilityDenialReason[] {
  return caps[name].denialReasons;
}

/** The single primary reason (precedence [0]) or null when allowed. */
export function primaryDenialReason(
  caps: AccountCapabilities,
  name: AccountCapabilityName,
): CapabilityDenialReason | null {
  return caps[name].denialReasons[0] ?? null;
}

/**
 * THE typed authorization error (Phase T). Carries ONLY machine-readable
 * reasons - safe to log in full. The API layer maps `primaryReason` to a safe
 * client code + HTTP status (401/403/409/503); it never leaks the raw reason
 * unless the client contract requires it. No user-facing prose here.
 */
export class CapabilityDeniedError extends Error {
  readonly capability: AccountCapabilityName;
  readonly primaryReason: CapabilityDenialReason;
  readonly reasons: CapabilityDenialReason[];
  constructor(capability: AccountCapabilityName, reasons: CapabilityDenialReason[]) {
    super(`capability_denied:${capability}:${reasons[0] ?? "UNKNOWN"}`);
    this.name = "CapabilityDeniedError";
    this.capability = capability;
    this.reasons = reasons;
    this.primaryReason = reasons[0] ?? "ACCOUNT_NOT_ACTIVE";
  }
}

/** Throw if a capability is denied - the one-liner every surface can use after
 *  resolving capabilities once per request. */
export function assertCapability(
  caps: AccountCapabilities,
  name: AccountCapabilityName,
): void {
  const d = caps[name];
  if (!d.allowed) throw new CapabilityDeniedError(name, d.denialReasons);
}

/**
 * Narrow VIEWER-access decision (canEnterDating) from the minimal session
 * signals - no badge/profile/entitlement load needed. This is the canonical
 * gate for whether a user may ACCESS Discovery (browse), which is distinct from
 * whether they may APPEAR in it (candidate eligibility - the query adapter).
 *
 * Deliberately NOT canAppearInDiscovery: gating browse on appearance would 403
 * a SHADOW_BANNED viewer (revealing the shadow-ban) and block users who hid
 * their own profile - both regressions. canEnterDating keeps them browsing while
 * still failing closed for pending/restricted/deactivated/deleted accounts.
 */
export function resolveDatingEntry(facts: {
  status: string;
  registrationComplete: boolean;
  faceVerificationRequired?: boolean;
  faceVerified?: boolean;
  trustFactsAvailable?: boolean;
}): CapabilityDecision {
  return resolveAccountCapabilities({
    ...facts,
    onboardingDone: true, // irrelevant to canEnterDating
    profileVisible: true, // irrelevant to canEnterDating
    badgeVisible: false, // irrelevant to canEnterDating
  }).canEnterDating;
}

/**
 * THE server-side entry point. Composes canonical signals from a user row.
 * `badgeVisible` + `profileVisible` are passed IN (badge is owned by the
 * dispatcher, which governance forbids re-deriving here; isVisible lives on the
 * Profile row). Feature toggles / entitlement / push signals are passed by the
 * calling surface; omitted ones use behavior-preserving defaults.
 */
export function getAccountCapabilities(
  user: GateUser & { onboardingDone: boolean },
  opts: {
    profileVisible: boolean;
    badgeVisible: boolean;
  } & Partial<
    Pick<
      CapabilityFacts,
      | "faceVerificationRequired"
      | "faceVerified"
      | "trustFactsAvailable"
      | "realtimeEnabled"
      | "datingNotificationsEnabled"
      | "billingEnabled"
      | "premiumEnabled"
      | "premiumRegionSupported"
      | "premiumProviderAvailable"
      | "entitlement"
      | "pushEnabled"
      | "pushPreferenceEnabled"
      | "pushPermissionGranted"
      | "deviceSubscription"
    >
  >,
): AccountCapabilities {
  return resolveAccountCapabilities({
    ...opts, // profileVisible, badgeVisible, and any feature toggles
    status: user.status,
    registrationComplete: registrationComplete(user),
    onboardingDone: user.onboardingDone,
  });
}
