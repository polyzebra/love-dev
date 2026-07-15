import "server-only";

/**
 * The code MINTS shared by every Tirvea OTP flow (signup, login, resend,
 * email attach, change email). Every 6-digit code is minted with GoTrue's
 * admin.generateLink (which sends NO Supabase email); delivery is the
 * single canonical branded email, sendBrandedOtpEmail (services/email.ts),
 * re-exported here so callers have one import. No OTP flow can fall back
 * to a Supabase template.
 *
 * The service-role admin client is imported LAZILY (server-only, and
 * unimportable under plain test runs); tests exercise renderOtpEmail and
 * sendBrandedOtpEmail with an injected spy provider instead.
 */

// One import for callers: the shared delivery lives in the email service
// (testable, not server-only); the mints below are service-role.
export { sendBrandedOtpEmail } from "@/lib/services/email";

type OtpError = { code?: string; message: string; status?: number } | null;

/**
 * Mint a 6-digit sign-in code for signup OR login (unified): a magiclink
 * generateLink auto-creates a new auth user and returns email_otp for an
 * existing one - the exact behaviour signInWithOtp({ shouldCreateUser })
 * had, minus Supabase's email. Verified with verifyOtp({ type: "email" }).
 */
export async function mintEmailLoginOtp(
  email: string,
): Promise<{ code: string | null; error: OtpError }> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data, error } = await supabaseAdmin().auth.admin.generateLink({
    type: "magiclink",
    email,
  } as Parameters<ReturnType<typeof supabaseAdmin>["auth"]["admin"]["generateLink"]>[0]);
  if (error) {
    return {
      code: null,
      error: { code: error.code, message: error.message, status: error.status },
    };
  }
  const code = (data?.properties as { email_otp?: string } | undefined)?.email_otp ?? null;
  return { code, error: null };
}

/**
 * Mint a 6-digit code for attaching/changing an email onto an EXISTING
 * auth user (userId), moving it to newEmail. Sends no Supabase email;
 * verified with verifyOtp({ type: "email_change" }) then force-committed
 * by the caller. `error.code === "email_exists"` = the address is taken.
 */
export async function mintEmailChangeOtp(
  userId: string,
  newEmail: string,
): Promise<{ code: string | null; error: OtpError }> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const admin = supabaseAdmin();
  const current = await admin.auth.admin.getUserById(userId);
  const currentEmail = current.data.user?.email;
  if (current.error || !currentEmail) {
    return {
      code: null,
      error: current.error
        ? { code: current.error.code, message: current.error.message, status: current.error.status }
        : { message: "current auth user has no email" },
    };
  }
  const { data, error } = await admin.auth.admin.generateLink({
    type: "email_change_new",
    email: currentEmail,
    newEmail,
  } as Parameters<typeof admin.auth.admin.generateLink>[0]);
  if (error) {
    return {
      code: null,
      error: { code: error.code, message: error.message, status: error.status },
    };
  }
  const code = (data?.properties as { email_otp?: string } | undefined)?.email_otp ?? null;
  return { code, error: null };
}
