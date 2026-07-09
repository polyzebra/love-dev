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
 *   VERIFICATION_PROVIDER = "stripe_identity" | "persona"
 *   - stripe_identity additionally requires STRIPE_SECRET_KEY
 *   - persona additionally requires PERSONA_API_KEY (+ PERSONA_TEMPLATE_ID)
 * Anything else (or missing keys) resolves to the not-configured provider,
 * and callers surface an honest "coming soon" instead of a fake flow.
 */

export type VerificationSessionStatus = "pending" | "approved" | "rejected" | "expired";

export type VerificationStart = {
  /** Opaque session reference on the provider side. */
  sessionId: string;
  /** Hosted flow URL to redirect the user to, when the provider has one. */
  url?: string;
};

export interface PhotoVerificationProvider {
  /** Persisted into User.photoVerificationProvider / Verification.provider. */
  readonly name: string;
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

/** Default provider: refuses honestly instead of pretending to verify. */
export const notConfiguredProvider: PhotoVerificationProvider = {
  name: "none",
  async start(): Promise<VerificationStart> {
    throw new VerificationNotConfiguredError();
  },
  async status(): Promise<VerificationSessionStatus> {
    throw new VerificationNotConfiguredError();
  },
};

/**
 * Stripe Identity placeholder. When the integration lands, start() creates
 * a VerificationSession (type "document" + selfie check) and returns its
 * client URL; status() maps session.status. Until the SDK call is written
 * it throws the same typed error so nothing fake ever runs - the route
 * turns it into the honest 503.
 */
const stripeIdentityProvider: PhotoVerificationProvider = {
  name: "stripe_identity",
  async start(): Promise<VerificationStart> {
    throw new VerificationNotConfiguredError(
      "Stripe Identity is selected but the integration is not implemented yet.",
    );
  },
  async status(): Promise<VerificationSessionStatus> {
    throw new VerificationNotConfiguredError(
      "Stripe Identity is selected but the integration is not implemented yet.",
    );
  },
};

/**
 * Persona placeholder. When the integration lands, start() creates an
 * inquiry from PERSONA_TEMPLATE_ID and returns its hosted-flow URL;
 * status() maps inquiry.attributes.status. Same honest-throw until then.
 */
const personaProvider: PhotoVerificationProvider = {
  name: "persona",
  async start(): Promise<VerificationStart> {
    throw new VerificationNotConfiguredError(
      "Persona is selected but the integration is not implemented yet.",
    );
  },
  async status(): Promise<VerificationSessionStatus> {
    throw new VerificationNotConfiguredError(
      "Persona is selected but the integration is not implemented yet.",
    );
  },
};

export function getPhotoVerificationProvider(): PhotoVerificationProvider {
  const which = process.env.VERIFICATION_PROVIDER?.trim().toLowerCase();
  if (which === "stripe_identity" && process.env.STRIPE_SECRET_KEY) return stripeIdentityProvider;
  if (which === "persona" && process.env.PERSONA_API_KEY) return personaProvider;
  return notConfiguredProvider;
}

export function isPhotoVerificationConfigured(): boolean {
  return getPhotoVerificationProvider() !== notConfiguredProvider;
}
