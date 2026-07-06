import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

/**
 * One-time token service backed by the VerificationToken table.
 * Raw tokens are sent to the user; only SHA-256 digests are stored.
 */

export type TokenPurpose = "email" | "password-reset" | "phone-otp" | "magic-link";

function digest(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function issueToken(
  identifier: string,
  purpose: TokenPurpose,
  ttlMinutes: number,
): Promise<string> {
  const raw = purpose === "phone-otp" ? String(randomInt(100000, 999999)) : randomBytes(32).toString("hex");

  // A new token invalidates previous ones for the same identifier+purpose.
  await db.verificationToken.deleteMany({ where: { identifier, purpose } });
  await db.verificationToken.create({
    data: {
      identifier,
      purpose,
      token: digest(raw),
      expires: new Date(Date.now() + ttlMinutes * 60_000),
    },
  });
  return raw;
}

export async function consumeToken(
  identifier: string,
  purpose: TokenPurpose,
  raw: string,
): Promise<boolean> {
  const record = await db.verificationToken.findFirst({ where: { identifier, purpose } });
  if (!record) return false;
  if (record.expires < new Date()) {
    await db.verificationToken.deleteMany({ where: { identifier, purpose } });
    return false;
  }
  const expected = Buffer.from(record.token, "hex");
  const actual = Buffer.from(digest(raw), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;

  await db.verificationToken.deleteMany({ where: { identifier, purpose } });
  return true;
}
