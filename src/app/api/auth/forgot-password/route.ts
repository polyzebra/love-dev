import { db } from "@/lib/db";
import { clientIp, guardRate, ok, parseBody } from "@/lib/api";
import { forgotPasswordSchema } from "@/lib/validators/auth";
import { issueToken } from "@/lib/tokens";
import { passwordResetEmail, sendMail } from "@/lib/mailer";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { env } from "@/lib/env";

export async function POST(req: Request) {
  const limited = await guardRate(`forgot:${clientIp(req)}`, RATE_LIMITS.forgotPassword);
  if (limited) return limited;

  const { data, response } = await parseBody(req, forgotPasswordSchema);
  if (response) return response;

  const user = await db.user.findUnique({ where: { email: data.email } });
  if (user?.passwordHash) {
    const token = await issueToken(user.email, "password-reset", 30);
    const url = `${env.NEXT_PUBLIC_APP_URL}/reset-password?email=${encodeURIComponent(user.email)}&token=${token}`;
    await sendMail(passwordResetEmail(user.email, url));
  }

  // Constant response - never reveal whether the account exists
  return ok({ message: "If that email is registered, a reset link is on its way." });
}
