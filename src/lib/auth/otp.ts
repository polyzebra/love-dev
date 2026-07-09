/**
 * OTP lengths per channel - Supabase/Twilio own code generation; the
 * app only mirrors their configured length so UI and validation match
 * end-to-end. Email length follows the Supabase dashboard setting
 * (Authentication -> Email -> "Email OTP Length", 6-10; this project
 * currently generates 8) via NEXT_PUBLIC_EMAIL_OTP_LENGTH. Codes are
 * never generated, stored or truncated by us.
 */
function clampLength(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(n) && n >= 6 && n <= 10 ? n : fallback;
}

export const EMAIL_OTP_LENGTH = clampLength(process.env.NEXT_PUBLIC_EMAIL_OTP_LENGTH, 6);

/** Twilio Verify codes are 6 digits (service default). */
export const PHONE_OTP_LENGTH = 6;
