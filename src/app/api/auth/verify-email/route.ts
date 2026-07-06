import { db } from "@/lib/db";
import { apiError, ok, parseBody } from "@/lib/api";
import { consumeToken } from "@/lib/tokens";
import { z } from "zod";

const schema = z.object({
  email: z.string().email(),
  token: z.string().min(10),
});

export async function POST(req: Request) {
  const { data, response } = await parseBody(req, schema);
  if (response) return response;

  const valid = await consumeToken(data.email, "email", data.token);
  if (!valid) {
    return apiError(400, "invalid_token", "This link is invalid or has expired.");
  }

  await db.user.update({
    where: { email: data.email },
    data: {
      emailVerified: new Date(),
      verifications: {
        updateMany: {
          where: { type: "EMAIL" },
          data: { status: "APPROVED" },
        },
      },
    },
  });

  return ok({ message: "Email confirmed. You can sign in now." });
}
