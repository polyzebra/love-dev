import { ok, apiError, validationError, guardRate, internalError } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { ipHashFrom } from "@/lib/auth/audit";
import { auth } from "@/lib/auth";
import { supportRequestSchema } from "@/lib/support/schema";
import { createSupportRequest } from "@/lib/services/support";

/**
 * POST /api/support - public contact/support intake.
 *
 * Order of defence: payload cap -> fail-closed rate limit (IP-hash keyed) ->
 * JSON parse -> Zod validation -> honeypot drop -> persist-first/notify-second.
 * A persistence failure returns 500 (fail closed - no fake success); a
 * notification failure never fails the request (it is stored either way).
 * Anonymous callers are allowed; a signed-in caller's id is attached.
 */

// Well above a 5000-char message + fields; below anything abusive.
const MAX_BODY_BYTES = 16 * 1024;

export async function POST(req: Request) {
  const declaredLen = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
    return apiError(413, "payload_too_large", "Your message is too long.");
  }

  // Fail-closed rate limit on the unauthenticated write path (IP hash only).
  const ipHash = ipHashFrom(req);
  const limited = await guardRate(`support:${ipHash ?? "unknown"}`, RATE_LIMITS.support);
  if (limited) return limited;

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return apiError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    return apiError(413, "payload_too_large", "Your message is too long.");
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return apiError(400, "invalid_json", "Request body must be valid JSON.");
  }

  const parsed = supportRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  // Honeypot: a filled `website` field marks a bot. Answer a normal success
  // (so the bot is not tipped off) but store nothing.
  if (parsed.data.website && parsed.data.website.length > 0) {
    return ok({ ok: true });
  }

  // Optional session: attach the id when signed in; never required.
  let userId: string | null = null;
  try {
    const session = await auth();
    userId = session?.user?.id ?? null;
  } catch {
    userId = null;
  }

  try {
    const result = await createSupportRequest(parsed.data, { ipHash, userId });
    return ok({ ok: true, id: result.id });
  } catch (error) {
    // Persist failure: fail closed. The user is told it did NOT go through.
    console.error("[support] create failed:", error);
    return internalError();
  }
}
