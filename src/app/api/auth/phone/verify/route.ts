import { NextResponse } from "next/server";
import { z } from "zod";
import parsePhoneNumberFromString from "libphonenumber-js";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/api";
import { phoneVerificationProvider, PhoneOtpNotConfiguredError } from "@/lib/auth/phone";
import { checkOtpVerifyBlocked } from "@/lib/auth/rate-limit";
import { ipHashFrom, recordAuthEvent } from "@/lib/auth/audit";
import { authNextStep } from "@/lib/auth/gate";

const bodySchema = z.object({
  phoneE164: z.string().trim().min(4).max(20),
  code: z.string().trim().regex(/^\d{6}$/),
});

const CODE_FAILED = "That code didn't work. Try again.";
const NUMBER_UNAVAILABLE = "That number can't be used right now.";

/**
 * POST /api/auth/phone/verify { phoneE164, code }
 * -> { ok: true, next } | { ok: false, error }
 *
 * Confirms the SMS code for the CURRENT user (phone_change flow), then
 * stamps the app row: canonical phoneE164 (+ legacy phone mirror),
 * country metadata, phoneVerifiedAt and authCompleted.
 */
export async function POST(req: Request) {
  const { user, response } = await requireSession();
  if (response) return response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: CODE_FAILED }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: CODE_FAILED }, { status: 400 });
  }

  const phone = parsePhoneNumberFromString(parsed.data.phoneE164);
  if (!phone || !phone.isValid()) {
    return NextResponse.json({ ok: false, error: CODE_FAILED }, { status: 400 });
  }
  const phoneE164 = phone.number;

  // Too many failed attempts -> blocked for the rest of the window
  const blocked = await checkOtpVerifyBlocked({ phoneE164, ipHash: ipHashFrom(req) });
  if (!blocked.ok) {
    await recordAuthEvent({
      type: "otp_verify_fail",
      phoneE164,
      userId: user.id,
      req,
      metadata: { reason: blocked.reason ?? "blocked" },
    });
    return NextResponse.json({ ok: false, error: CODE_FAILED }, { status: 429 });
  }

  let verified: boolean;
  try {
    verified = await phoneVerificationProvider().verifyCode(phoneE164, parsed.data.code);
  } catch (error) {
    if (error instanceof PhoneOtpNotConfiguredError) {
      return NextResponse.json(
        { ok: false, error: "Phone verification is not available yet" },
        { status: 503 },
      );
    }
    throw error;
  }
  if (!verified) {
    await recordAuthEvent({
      type: "otp_verify_fail",
      phoneE164,
      userId: user.id,
      req,
    });
    return NextResponse.json({ ok: false, error: CODE_FAILED }, { status: 400 });
  }

  // Last line of the one-phone-one-account defense (also enforced by the
  // unique index - this just keeps the error friendly under a race)
  const holder = await db.user.findUnique({ where: { phoneE164 } });
  if (holder && holder.id !== user.id) {
    await recordAuthEvent({ type: "phone_otp_send_conflict", phoneE164, userId: user.id, req });
    return NextResponse.json({ ok: false, error: NUMBER_UNAVAILABLE }, { status: 409 });
  }

  const now = new Date();
  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      phoneE164,
      phoneCountryIso: phone.country ?? null,
      phoneDialCode: `+${phone.countryCallingCode}`,
      phoneVerifiedAt: now,
      // Legacy mirror columns - kept in sync until fully retired
      phone: phoneE164,
      phoneVerified: now,
      authCompleted: true,
    },
  });

  await recordAuthEvent({ type: "phone_otp_verify", phoneE164, userId: user.id, req });
  return NextResponse.json({ ok: true, next: authNextStep(updated) });
}
