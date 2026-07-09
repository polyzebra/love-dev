import { supabaseServer } from "@/lib/supabase/server";
import { isPhoneVerificationEnabled } from "@/lib/auth/gate";

/**
 * Phone verification behind a tiny provider interface so the SMS vendor
 * is swappable. The Supabase implementation verifies the phone FOR THE
 * SIGNED-IN USER via the phone-change flow:
 *
 *   updateUser({ phone })  -> Supabase texts a code to the new number
 *   verifyOtp({ phone, token, type: "phone_change" }) -> confirms it
 *
 * signInWithOtp({ phone }) is deliberately NOT used - it would mint a
 * separate phone-keyed auth identity instead of attaching the number to
 * the current account.
 */

export class PhoneOtpNotConfiguredError extends Error {
  constructor() {
    super("Phone verification is not configured (SUPABASE_PHONE_ENABLED != true)");
    this.name = "PhoneOtpNotConfiguredError";
  }
}

export interface PhoneVerificationProvider {
  /** Text a one-time code to the number (E.164) for the current session's user. */
  sendCode(phoneE164: string): Promise<void>;
  /** Verify the code; true = the current user now owns this number in Supabase Auth. */
  verifyCode(phoneE164: string, code: string): Promise<boolean>;
}

const supabaseProvider: PhoneVerificationProvider = {
  async sendCode(phoneE164) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.updateUser({ phone: phoneE164 });
    if (error) throw new Error(`phone otp send failed: ${error.code ?? error.message}`);
  },
  async verifyCode(phoneE164, code) {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.verifyOtp({
      phone: phoneE164,
      token: code,
      type: "phone_change",
    });
    if (error || !data.user) return false;
    return true;
  },
};

const notConfiguredProvider: PhoneVerificationProvider = {
  async sendCode() {
    throw new PhoneOtpNotConfiguredError();
  },
  async verifyCode() {
    throw new PhoneOtpNotConfiguredError();
  },
};

/** Active provider - Supabase Phone Auth (Twilio) when enabled, else a 503 thrower. */
export function phoneVerificationProvider(): PhoneVerificationProvider {
  return isPhoneVerificationEnabled() ? supabaseProvider : notConfiguredProvider;
}
