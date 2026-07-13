import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, withUnavailableGuard, authOk, authError } from "@/lib/api";
import { sendPhoneVerification } from "@/lib/auth/phone-flow";
import { authNextStep } from "@/lib/auth/gate";

const bodySchema = z.object({
  phoneE164: z.string().trim().min(4).max(20),
  countryIso: z.string().trim().length(2).optional(),
  dialCode: z.string().trim().max(6).optional(),
});

const NUMBER_UNAVAILABLE = "That number can't be used right now.";
const PHONE_UNAVAILABLE = "Phone verification is temporarily unavailable.";
const DUPLICATE_PHONE =
  "This phone number is already verified on another Tirvea account. Please use a different number or sign in to the account that owns it.";
const INVALID_PHONE = "Enter a valid phone number.";
const UNSUPPORTED_COUNTRY =
  "We can't verify numbers from that country yet. Please use a different number.";

/**
 * POST /api/auth/phone/send { phoneE164, countryIso?, dialCode? }
 * -> { ok: true, retryAfter }                     code was (re)sent / rate-limited
 * -> { ok: true, alreadyVerified: true, next }    this number is already verified
 *                                                 on THIS account - continue the flow
 * -> 400 { ok: false, code: "invalid_phone" | "unsupported_country", error }
 * -> 409 { ok: false, code: "duplicate_phone", error }  number verified on ANOTHER account
 * -> 503 { ok: false, error, blocked: true } when SMS cannot go out
 *    (provider outage or feature flag off) - the step is NOT skippable
 *
 * Requires a signed-in session (phone attaches to the CURRENT account).
 * Ordering guarantees (normalize -> ownership -> rate limit -> provider)
 * live in sendPhoneVerification - see src/lib/auth/phone-flow.ts.
 * Rate-limited sends return the SAME neutral 200 as real sends -
 * `retryAfter` is the only thing the caller learns either way.
 */
export const POST = withUnavailableGuard(
  "auth:phone/send",
  async (req: Request) => {
    const { user, response } = await requireSession();
    if (response) return response;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, code: "invalid_phone", error: INVALID_PHONE },
        { status: 400 },
      );
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, code: "invalid_phone", error: INVALID_PHONE },
        { status: 400 },
      );
    }

    const outcome = await sendPhoneVerification({
      user,
      phone: parsed.data.phoneE164,
      countryIso: parsed.data.countryIso,
      req,
    });

    switch (outcome.kind) {
      case "invalid_phone":
        return NextResponse.json(
          { ok: false, code: "invalid_phone", error: INVALID_PHONE },
          { status: 400 },
        );
      case "unsupported_country":
        return NextResponse.json(
          { ok: false, code: "unsupported_country", error: UNSUPPORTED_COUNTRY },
          { status: 400 },
        );
      case "account_blocked":
        return authError(403, "number_unavailable", NUMBER_UNAVAILABLE);
      case "duplicate_phone":
        // Dev diagnostic - console only, never UI. A 409 here means the
        // number is verified on a DIFFERENT canonical account (identity =
        // auth.users.id = User.id; one email -> one account). See
        // docs/IDENTITY.md "Two emails = two accounts".
        console.warn(
          `[auth:phone/send] duplicate_phone: authUserId=appUserId=${user.id} ` +
            `phoneOwner=${outcome.holderId} provider=${user.provider ?? "?"} ` +
            `onboardingDone=${user.onboardingDone} authCompleted=${user.authCompleted}`,
        );
        return NextResponse.json(
          { ok: false, code: "duplicate_phone", error: DUPLICATE_PHONE },
          { status: 409 },
        );
      case "already_verified":
        // Success state - the flow simply continues to the next step.
        return NextResponse.json({
          ok: true,
          alreadyVerified: true,
          next: authNextStep(outcome.user),
        });
      case "provider_rejected":
        return NextResponse.json(
          { ok: false, error: outcome.message },
          { status: outcome.httpStatus },
        );
      case "unavailable":
        return NextResponse.json(
          { ok: false, error: PHONE_UNAVAILABLE, blocked: true },
          { status: 503 },
        );
      case "sent":
        return authOk({ retryAfter: outcome.retryAfter });
    }
  },
  PHONE_UNAVAILABLE,
);
