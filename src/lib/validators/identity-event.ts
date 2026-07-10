import { z } from "zod";

/**
 * Audit events for the Settings > Sign-in methods identity actions.
 * `link_started` fires when the user kicks off manual identity linking,
 * `unlink` after a successful unlinkIdentity. Kept as a tiny pure module
 * so the mapping is unit-testable without a request context.
 */

export const identityEventSchema = z.object({
  action: z.enum(["link_started", "unlink"]),
  provider: z.string().trim().min(1).max(32).optional(),
});

export type IdentityEventInput = z.infer<typeof identityEventSchema>;

/** Maps the client action to the recorded AuthVerificationEvent type. */
export function identityEventType(
  action: IdentityEventInput["action"],
): "auth_identity_linked" | "auth_identity_unlinked" {
  return action === "link_started" ? "auth_identity_linked" : "auth_identity_unlinked";
}
