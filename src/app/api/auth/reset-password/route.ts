import { db } from "@/lib/db";
import { apiError, ok, parseBody } from "@/lib/api";
import { resetPasswordSchema } from "@/lib/validators/auth";
import { hashPassword, passwordIssues } from "@/lib/passwords";
import { consumeToken } from "@/lib/tokens";

export async function POST(req: Request) {
  const { data, response } = await parseBody(req, resetPasswordSchema);
  if (response) return response;

  const weakness = passwordIssues(data.password);
  if (weakness) return apiError(422, "weak_password", weakness, { password: [weakness] });

  const valid = await consumeToken(data.email, "password-reset", data.token);
  if (!valid) return apiError(400, "invalid_token", "This link is invalid or has expired.");

  await db.user.update({
    where: { email: data.email },
    data: { passwordHash: await hashPassword(data.password) },
  });

  // Invalidate all sessions after a password change
  const user = await db.user.findUnique({ where: { email: data.email }, select: { id: true } });
  if (user) await db.session.deleteMany({ where: { userId: user.id } });

  return ok({ message: "Password updated. Sign in with your new password." });
}
