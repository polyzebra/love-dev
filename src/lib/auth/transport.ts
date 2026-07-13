/**
 * Authentication transport decision - the ONE place that decides how a
 * request's credentials resolve to an identity. Pure module: no Next.js
 * imports, no I/O, fully unit-tested (tests/auth-transport.test.ts).
 *
 * Two transports exist:
 *  - Supabase SSR cookies (the browser session - unchanged behaviour)
 *  - Authorization: Bearer <Supabase access token> (native/API clients)
 *
 * Deterministic rules (never silently choose a different user):
 *  - No Authorization header        -> cookie transport (as always)
 *  - Malformed/non-Bearer header    -> REJECT, even if a cookie session
 *    exists: a client that sends credentials must send valid ones -
 *    falling back could execute a request as a different identity than
 *    the caller intended.
 *  - Invalid/expired Bearer token   -> REJECT (same reasoning).
 *  - Valid Bearer + cookie session resolving to a DIFFERENT user
 *                                   -> REJECT (conflicting identities).
 *  - Valid Bearer + same-user cookie (or no/unresolvable cookie)
 *                                   -> Bearer identity proceeds.
 *
 * Token contents are never parsed, decoded or logged here - verification
 * happens exclusively via Supabase Auth (`auth.getUser(token)`), which
 * validates signature, expiry and revocation server-side.
 */

export type BearerParse =
  { kind: "none" } | { kind: "malformed" } | { kind: "token"; token: string };

/**
 * Strict Authorization-header parse. Accepts exactly one form:
 * `Bearer <single-token>` (scheme case-insensitive, surrounding
 * whitespace tolerated). Anything else present-but-unusable is
 * `malformed` and MUST reject the request - never fall through.
 */
export function parseAuthorizationHeader(header: string | null | undefined): BearerParse {
  if (header == null || header.trim() === "") return { kind: "none" };
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
  if (!match) return { kind: "malformed" };
  return { kind: "token", token: match[1] };
}

export type TransportDecision =
  | { ok: true; transport: "cookie" | "bearer" }
  | {
      ok: false;
      reason:
        | "no_credentials"
        | "malformed_authorization"
        | "invalid_bearer"
        | "conflicting_identities"
        | "invalid_cookie";
    };

/**
 * The full decision matrix over RESOLVED identities. Callers resolve
 * each credential through Supabase Auth first (null = absent or failed
 * verification), then this function decides - so the rules above live
 * in exactly one reviewable place.
 */
export function decideIdentity(input: {
  bearer: BearerParse;
  /** Verified identity of the bearer token, when bearer.kind === "token". */
  bearerUserId: string | null;
  /** Verified identity of the cookie session, when cookies were present. */
  cookieUserId: string | null;
  /** Whether any sb-* auth cookies were present on the request at all. */
  hasCookieCredentials: boolean;
}): TransportDecision {
  const { bearer, bearerUserId, cookieUserId, hasCookieCredentials } = input;

  if (bearer.kind === "malformed") return { ok: false, reason: "malformed_authorization" };

  if (bearer.kind === "token") {
    if (!bearerUserId) return { ok: false, reason: "invalid_bearer" };
    if (hasCookieCredentials && cookieUserId && cookieUserId !== bearerUserId) {
      return { ok: false, reason: "conflicting_identities" };
    }
    return { ok: true, transport: "bearer" };
  }

  // No Authorization header: the classic cookie path.
  if (!hasCookieCredentials) return { ok: false, reason: "no_credentials" };
  if (!cookieUserId) return { ok: false, reason: "invalid_cookie" };
  return { ok: true, transport: "cookie" };
}
