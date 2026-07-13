import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, withUnavailableGuard, authOk } from "@/lib/api";
import { confirmPhoneVerification } from "@/lib/auth/phone-flow";
import { authNextStep } from "@/lib/auth/gate";

const bodySchema = z.object({
  phoneE164: z.string().trim().min(4).max(20),
  countryIso: z.string().trim().length(2).optional(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});

const CODE_FAILED = "That code didn't work. Try again.";
const UNSUPPORTED_COUNTRY =
  "We can't verify numbers from that country yet. Please use a different number.";
const CODE_EXPIRED = "That code has expired. Request a new one.";
const LOCKED = "Too many attempts. Please try again in a few minutes.";
const DUPLICATE_PHONE =
  "This phone number is already verified on another Tirvea account. Please use a different number or sign in to the account that owns it.";

/**
 * POST /api/auth/phone/verify { phoneE164, code, countryIso? }
 * -> { ok: true, next } | { ok: false, code?, error }
 *
 * Confirms the SMS code for the CURRENT user, then stamps the app row
 * inside a race-safe transaction: canonical phoneE164 (+ legacy phone
 * mirror), country metadata, phoneVerifiedAt and authCompleted. All
 * ordering/ownership guarantees live in confirmPhoneVerification
 * (src/lib/auth/phone-flow.ts).
 */
export const POST = withUnavailableGuard(
  "auth:phone/verify",
  async (req: Request) => {
    const { user, response } = await requireSession();
    if (response) return response;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, code: "incorrect_code", error: CODE_FAILED },
        { status: 400 },
      );
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, code: "incorrect_code", error: CODE_FAILED },
        { status: 400 },
      );
    }

    const outcome = await confirmPhoneVerification({
      user,
      phone: parsed.data.phoneE164,
      code: parsed.data.code,
      countryIso: parsed.data.countryIso,
      req,
    });

    switch (outcome.kind) {
      case "invalid_phone":
        return NextResponse.json(
          { ok: false, code: "invalid_phone", error: CODE_FAILED },
          { status: 400 },
        );
      case "unsupported_country":
        return NextResponse.json(
          { ok: false, code: "unsupported_country", error: UNSUPPORTED_COUNTRY },
          { status: 400 },
        );
      case "locked":
        return NextResponse.json(
          { ok: false, code: "too_many_attempts", error: LOCKED },
          { status: 429 },
        );
      case "account_blocked":
        return NextResponse.json(
          { ok: false, code: "account_blocked", error: CODE_FAILED },
          { status: 403 },
        );
      case "duplicate_phone":
        // Dev diagnostic - console only, never UI. See docs/IDENTITY.md
        // "Two emails = two accounts".
        console.warn(
          `[auth:phone/verify] duplicate_phone: authUserId=appUserId=${user.id} ` +
            `phoneOwner=${outcome.holderId} provider=${user.provider ?? "?"} ` +
            `onboardingDone=${user.onboardingDone} authCompleted=${user.authCompleted}`,
        );
        return NextResponse.json(
          { ok: false, code: "duplicate_phone", error: DUPLICATE_PHONE },
          { status: 409 },
        );
      case "expired":
        return NextResponse.json(
          { ok: false, code: "code_expired", error: CODE_EXPIRED },
          { status: 400 },
        );
      case "incorrect":
        return NextResponse.json(
          { ok: false, code: "incorrect_code", error: CODE_FAILED },
          { status: 400 },
        );
      case "provider_rejected":
        return NextResponse.json(
          { ok: false, error: outcome.message },
          { status: outcome.httpStatus },
        );
      case "unavailable":
        return NextResponse.json(
          { ok: false, error: "Phone verification is temporarily unavailable.", blocked: true },
          { status: 503 },
        );
      case "already_verified":
      case "verified":
        return authOk({ next: authNextStep(outcome.user) });
    }
  },
  "Phone verification is temporarily unavailable.",
);
