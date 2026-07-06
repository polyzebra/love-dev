import { db } from "@/lib/db";
import { apiError, clientIp, created, guardRate, parseBody } from "@/lib/api";
import { registerSchema } from "@/lib/validators/auth";
import { hashPassword, passwordIssues } from "@/lib/passwords";
import { issueToken } from "@/lib/tokens";
import { sendMail, verificationEmail } from "@/lib/mailer";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { env } from "@/lib/env";

export async function POST(req: Request) {
  const limited = await guardRate(`register:${clientIp(req)}`, RATE_LIMITS.register);
  if (limited) return limited;

  const { data, response } = await parseBody(req, registerSchema);
  if (response) return response;

  const weakness = passwordIssues(data.password);
  if (weakness) {
    return apiError(422, "weak_password", weakness, { password: [weakness] });
  }

  const existing = await db.user.findUnique({ where: { email: data.email } });
  if (existing) {
    // Same response shape as success - do not leak which emails exist
    return created({ message: "Check your inbox to confirm your email." });
  }

  const user = await db.user.create({
    data: {
      email: data.email,
      name: data.name,
      passwordHash: await hashPassword(data.password),
      marketingOptIn: data.marketingOptIn,
      subscription: { create: { tier: "FREE" } },
      verifications: { create: { type: "EMAIL", status: "PENDING" } },
    },
  });

  const token = await issueToken(user.email, "email", 24 * 60);
  const url = `${env.NEXT_PUBLIC_APP_URL}/verify-email?email=${encodeURIComponent(user.email)}&token=${token}`;
  await sendMail(verificationEmail(user.email, url));

  return created({ message: "Check your inbox to confirm your email." });
}
