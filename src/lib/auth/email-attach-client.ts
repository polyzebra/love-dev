import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailAttachAuthClient } from "@/lib/auth/email-attach-flow";
import { pickEmailProvider, renderEmailAttachOtpEmail } from "@/lib/services/email";

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
    async generateEmailChangeOtp({ userId, newEmail }) {
      const { supabaseAdmin } = await import("@/lib/supabase/admin");
      const admin = supabaseAdmin();
      // generateLink(email_change_new) needs the CURRENT auth email exactly
      // as auth.users holds it (the phone-first placeholder). Resolve it
      // server-side rather than trusting the app row.
      const current = await admin.auth.admin.getUserById(userId);
      const currentEmail = current.data.user?.email;
      if (current.error || !currentEmail) {
        return {
          code: null,
          error: current.error ?? { message: "current auth user has no email" },
        };
      }
      const { data, error } = await admin.auth.admin.generateLink({
        // "email_change_new" is a valid GoTrue link type but not in the
        // installed auth-js union - assert the shape locally.
        type: "email_change_new",
        email: currentEmail,
        newEmail,
      } as Parameters<typeof admin.auth.admin.generateLink>[0]);
      if (error) return { code: null, error };
      const code = (data?.properties as { email_otp?: string } | undefined)?.email_otp ?? null;
      return { code, error: null };
    },

    async sendOtpEmail({ to, code }) {
      const rendered = renderEmailAttachOtpEmail(code);
      const result = await pickEmailProvider().send({
        to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
      if (result.ok) return { error: null };
      return { error: { code: result.errorCode, message: result.errorMessage } };
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
