import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { phoneLoginEnabled } from "@/lib/auth/phone";
import { maskPhone } from "@/lib/phone-mask";
import { SettingsSubheader } from "@/components/settings/settings-subheader";
import { SignInMethods } from "@/components/settings/sign-in-methods";

export const metadata: Metadata = { title: "Sign-in methods" };

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
