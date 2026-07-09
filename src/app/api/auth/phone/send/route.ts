import { NextResponse } from "next/server";
import { z } from "zod";
import parsePhoneNumberFromString from "libphonenumber-js";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/api";
import {
  phoneVerificationProvider,
  PhoneOtpNotConfiguredError,
  PhoneProviderRejectedError,
} from "@/lib/auth/phone";
import { resendCooldown } from "@/lib/auth/rate-limit";
import { recordAuthEvent } from "@/lib/auth/audit";

const bodySchema = z.object({
  phoneE164: z.string().trim().min(4).max(20),
  countryIso: z.string().trim().length(2).optional(),
  dialCode: z.string().trim().max(6).optional(),
});

const NUMBER_UNAVAILABLE = "That number can't be used right now.";
const PHONE_UNAVAILABLE = "Phone verification is temporarily unavailable.";

/**
 * POST /api/auth/phone/send { phoneE164, countryIso?, dialCode? }
 * -> { ok: true, retryAfter } | { ok: false, error }
 * -> 503 { ok: false, error, blocked: true } when SMS cannot go out
 *    (provider outage or feature flag off) - the step is NOT skippable
 *
 * Requires a signed-in session (phone attaches to the CURRENT account).
 * One phone = one account: a number already verified elsewhere gets the
 * same neutral copy as any other rejection. Rate-limited sends return the
 * SAME neutral 200 as real sends - `retryAfter` (seconds until the resend
 * unlocks) is the only thing the caller learns either way.
 */
export async function POST(req: Request) {
  const { user, response } = await requireSession();
  if (response) return response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Enter a valid phone number." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Enter a valid phone number." }, { status: 400 });
  }

  // Server-side E.164 validation - never trust the client's parsing
  const phone = parsePhoneNumberFromString(parsed.data.phoneE164);
  if (!phone || !phone.isValid()) {
    return NextResponse.json({ ok: false, error: "Enter a valid phone number." }, { status: 400 });
  }
  const phoneE164 = phone.number; // canonical E.164

  // Banned accounts don't get to burn SMS credits
  if (user.bannedAt || user.status === "SUSPENDED") {
    await recordAuthEvent({ type: "phone_otp_send_blocked", phoneE164, userId: user.id, req });
    return NextResponse.json({ ok: false, error: NUMBER_UNAVAILABLE }, { status: 403 });
  }

  // ONE PHONE = ONE ACCOUNT - neutral copy, never "this number is taken"
  const holder = await db.user.findUnique({ where: { phoneE164 } });
  if (holder && holder.id !== user.id) {
    await recordAuthEvent({ type: "phone_otp_send_conflict", phoneE164, userId: user.id, req });
    return NextResponse.json({ ok: false, error: NUMBER_UNAVAILABLE }, { status: 409 });
  }

  // Escalating resend cooldown (30s -> 60s -> 120s) + 5 sends/hour per
  // number. Limited requests get the SAME neutral 200 as real sends.
  const cooldown = await resendCooldown("phone", phoneE164);
  if (!cooldown.allowed) {
    await recordAuthEvent({
      type: "phone_otp_send_limited",
      phoneE164,
      userId: user.id,
      req,
      metadata: { reason: "resend_cooldown", retryAfter: cooldown.retryAfter },
    });
    return NextResponse.json({ ok: true, retryAfter: cooldown.retryAfter });
  }

  try {
    await phoneVerificationProvider().sendCode(phoneE164);
  } catch (error) {
    // Vendor-side policy rejection (invalid number, Verify's own send
    // cap): OUR neutral copy to the caller, the real cause in the audit.
    if (error instanceof PhoneProviderRejectedError) {
      await recordAuthEvent({
        type: "phone_otp_send_rejected",
        phoneE164,
        userId: user.id,
        req,
        metadata: error.auditMetadata,
      });
      return NextResponse.json(
        { ok: false, error: error.neutralMessage },
        { status: error.httpStatus },
      );
    }
    // Both failure modes block (503 + blocked:true - the client shows
    // the "temporarily unavailable" notice with NO skip path). When the
    // flag is off entirely the gate never routes here in the first
    // place; a provider outage while the flag is ON must never become
    // a verification bypass. See the gate comment in lib/auth/gate.ts.
    if (!(error instanceof PhoneOtpNotConfiguredError)) {
      console.error(`[auth:phone/send] provider failed:`, error);
      await recordAuthEvent({
        type: "phone_otp_send_error",
        phoneE164,
        userId: user.id,
        req,
      });
    }
    return NextResponse.json(
      { ok: false, error: PHONE_UNAVAILABLE, blocked: true },
      { status: 503 },
    );
  }

  await recordAuthEvent({
    type: "phone_otp_send",
    phoneE164,
    userId: user.id,
    req,
    metadata: {
      countryIso: parsed.data.countryIso ?? phone.country ?? null,
      dialCode: parsed.data.dialCode ?? `+${phone.countryCallingCode}`,
    },
  });
  return NextResponse.json({ ok: true, retryAfter: cooldown.retryAfter });
}
