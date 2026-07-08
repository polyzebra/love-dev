import { env, isProd } from "@/lib/env";

/**
 * Mail delivery. Provider-agnostic: in development messages are logged;
 * in production wire RESEND_API_KEY (or swap the transport) - templates
 * stay identical either way.
 */

type Mail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export async function sendMail(mail: Mail): Promise<void> {
  if (!isProd || !env.RESEND_API_KEY) {
    console.info(`[mail:dev] to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }),
  });
  if (!res.ok) {
    console.error("[mail] delivery failed", res.status, await res.text());
  }
}

export function verificationEmail(to: string, url: string): Mail {
  return {
    to,
    subject: "Confirm your email - Tirvea",
    text: `Welcome to Tirvea!\n\nConfirm your email address to get started:\n${url}\n\nThis link expires in 24 hours. If you didn't create an account, you can ignore this email.`,
  };
}

export function passwordResetEmail(to: string, url: string): Mail {
  return {
    to,
    subject: "Reset your password - Tirvea",
    text: `We received a request to reset your Tirvea password.\n\nReset it here (link expires in 30 minutes):\n${url}\n\nIf you didn't request this, your account is safe and you can ignore this email.`,
  };
}
