import type { Metadata } from "next";
import { EmailAttachStep } from "@/components/auth/EmailAttachStep";

export const metadata: Metadata = {
  title: "Add your email - Tirvea",
};

/**
 * /auth/email - the AUTHENTICATED email-attach step (gate rung between
 * phone and age): phone-first accounts replace their placeholder address
 * with a real, verified email here. Email-first/OAuth users never see it
 * (their address is already verified). Anonymous email LOGIN lives at
 * /login/email - a different flow entirely.
 */
export default function EmailAttachPage() {
  return <EmailAttachStep />;
}
