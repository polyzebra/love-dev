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
  if (current.error) {
    return {
      code: null,
      error: {
        code: current.error.code,
        message: current.error.message,
        status: current.error.status,
      },
    };
  }
  let currentEmail = current.data.user?.email?.trim() || null;

  // Native phone-first accounts sign up with a phone and NO auth.users email
  // (auth.users.email is empty; the placeholder lives only in the app row).
  // email_change_new needs a current address to move FROM, so seed the
  // account's OWN unroutable placeholder onto auth.users first - idempotent,
  // matches the app row, sends nothing. Without this the mint fails with a
  // code-less error and the attach screen wrongly shows a transport error
  // ("We couldn't send the code") for every genuinely phone-first user.
  if (!currentEmail) {
    const { phonePlaceholderEmail } = await import("@/lib/auth/identity");
    const placeholder = phonePlaceholderEmail(userId);
    const seed = await admin.auth.admin.updateUserById(userId, {
      email: placeholder,
      email_confirm: true,
    });
    if (seed.error || !seed.data.user?.email) {
      return {
        code: null,
        error: seed.error
          ? { code: seed.error.code, message: seed.error.message, status: seed.error.status }
          : { message: "could not seed placeholder email for phone-first account" },
      };
    }
    currentEmail = placeholder;
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
