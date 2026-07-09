import { NextResponse } from "next/server";
import { z } from "zod";
import parsePhoneNumberFromString from "libphonenumber-js";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/api";
import { phoneVerificationProvider, PhoneOtpNotConfiguredError } from "@/lib/auth/phone";
import { checkPhoneOtpSendLimit } from "@/lib/auth/rate-limit";
import { recordAuthEvent } from "@/lib/auth/audit";

const bodySchema = z.object({
  phoneE164: z.string().trim().min(4).max(20),
  countryIso: z.string().trim().length(2).optional(),
  dialCode: z.string().trim().max(6).optional(),
});

const NUMBER_UNAVAILABLE = "That number can't be used right now.";

/**
 * POST /api/auth/phone/send { phoneE164, countryIso?, dialCode? }
 * -> { ok: true } | { ok: false, error } | 503 when no SMS provider
 *
 * Requires a signed-in session (phone attaches to the CURRENT account).
 * One phone = one account: a number already verified elsewhere gets the
 * same neutral copy as any other rejection.
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

  const limit = await checkPhoneOtpSendLimit(phoneE164);
  if (!limit.ok) {
    await recordAuthEvent({ type: "phone_otp_send_limited", phoneE164, userId: user.id, req });
    return NextResponse.json(
      { ok: false, error: "Too many codes requested for this number. Try again later." },
      { status: 429 },
    );
  }

  try {
    await phoneVerificationProvider().sendCode(phoneE164);
  } catch (error) {
    if (error instanceof PhoneOtpNotConfiguredError) {
      return NextResponse.json(
        { ok: false, error: "Phone verification is not available yet" },
        { status: 503 },
      );
    }
    console.error(`[auth:phone/send] provider failed:`, error);
    await recordAuthEvent({
      type: "phone_otp_send_error",
      phoneE164,
      userId: user.id,
      req,
    });
    return NextResponse.json(
      { ok: false, error: "We couldn't send a code right now. Try again in a moment." },
      { status: 502 },
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
  return NextResponse.json({ ok: true });
}
