import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { phoneLoginEnabled } from "@/lib/auth/phone";
import { SettingsSubheader } from "@/components/settings/settings-subheader";
import { SignInMethods } from "@/components/settings/sign-in-methods";

export const metadata: Metadata = { title: "Sign-in methods" };

/**
 * Mask a verified number for display: keep the dial code and the last
 * three digits, hide the rest. "+353861234333" -> "+353 ••• ••• 333".
 * Only the masked string ever reaches the client component.
 */
function maskPhone(e164: string, dialCode: string | null): string {
  const dial = dialCode && e164.startsWith(dialCode) ? dialCode : e164.slice(0, 4);
  const national = e164.slice(dial.length);
  if (national.length <= 3) return `${dial} ${national}`;
  const masked = "•".repeat(national.length - 3) + national.slice(-3);
  const groups: string[] = [];
  for (let end = masked.length; end > 0; end -= 3) {
    groups.unshift(masked.slice(Math.max(0, end - 3), end));
  }
  return `${dial} ${groups.join(" ")}`;
}

export default async function SignInMethodsPage() {
  const user = await requireUser();

  // The session doesn't carry the raw number - fetch the canonical
  // phone columns for display masking only.
  const phoneRow = await db.user.findUnique({
    where: { id: user.id },
    select: { phoneE164: true, phoneDialCode: true },
  });

  const phoneVerified = Boolean(user.phoneVerifiedAt && phoneRow?.phoneE164);
  const masked =
    phoneVerified && phoneRow?.phoneE164
      ? maskPhone(phoneRow.phoneE164, phoneRow.phoneDialCode)
      : null;

  const appleFlag = process.env.NEXT_PUBLIC_APPLE_LOGIN_ENABLED;
  const appleVisible = appleFlag === "true" || appleFlag === "1";

  return (
    <>
      <SettingsSubheader
        backHref="/settings"
        backLabel="Back to settings"
        title="Sign-in methods"
        description="How you get into your account."
      />

      <SignInMethods
        email={user.email}
        linkedProviders={user.linkedProviders}
        appleVisible={appleVisible}
        phone={{
          masked,
          verified: phoneVerified,
          loginEnabled: phoneLoginEnabled(),
        }}
      />
    </>
  );
}
