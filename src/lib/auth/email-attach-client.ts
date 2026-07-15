import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailAttachAuthClient } from "@/lib/auth/email-attach-flow";
import { mintEmailChangeOtp, sendBrandedOtpEmail } from "@/lib/auth/otp-email";

/**
 * Production wiring for the AUTHENTICATED email-attach / change-email flow.
 *
 * The previous branded 6-digit OTP experience was produced by a Supabase
 * email TEMPLATE; when that template reverted to the default it started
 * shipping a confirmation LINK ("Confirm your new email address") while the
 * Tirvea UI still asked for a code. To make this impossible to regress, the
 * flow now owns delivery end to end:
 *
 *   generateEmailChangeOtp - admin.generateLink({ type: "email_change_new" })
 *     mints the 6-digit code and returns it WITHOUT sending any Supabase
 *     email (generateLink never sends - it exists for custom delivery).
 *   sendOtpEmail          - Tirvea's own Resend pipeline (services/email.ts)
 *     delivers the branded code. Supabase templates are out of the loop.
 *   verifyOtp             - the live session client confirms possession.
 *   commitEmailChange     - admin.updateUserById({ email, email_confirm })
 *     force-commits the address onto auth.users, independent of the
 *     "Secure email change" toggle and sending no email.
 *
 * The service-role admin client is imported LAZILY (it is "server-only" and
 * unimportable under plain test runs); tests inject their own structural
 * EmailAttachAuthClient instead of constructing this.
 */
export function realEmailAttachClient(ssr: SupabaseClient): EmailAttachAuthClient {
  return {
    // Both the mint and the delivery are the SHARED OTP path (otp-email.ts):
    // identical branded email + sender as signup/login, no Supabase email.
    generateEmailChangeOtp({ userId, newEmail }) {
      return mintEmailChangeOtp(userId, newEmail);
    },

    async sendOtpEmail({ to, code }) {
      const { error } = await sendBrandedOtpEmail(to, code);
      return { error };
    },

    async verifyOtp(params) {
      const { data, error } = await ssr.auth.verifyOtp(params);
      return {
        data: { user: data?.user ?? null, session: data?.session ?? null },
        error: error ? { code: error.code, message: error.message, status: error.status } : null,
      };
    },

    async commitEmailChange({ userId, email }) {
      const { supabaseAdmin } = await import("@/lib/supabase/admin");
      const admin = supabaseAdmin();
      const { data, error } = await admin.auth.admin.updateUserById(userId, {
        email,
        email_confirm: true,
      });
      if (error) {
        return {
          committedEmail: null,
          error: { code: error.code, message: error.message, status: error.status },
        };
      }
      return { committedEmail: data.user?.email ?? null, error: null };
    },
  };
}
