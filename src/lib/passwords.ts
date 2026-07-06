import bcrypt from "bcryptjs";

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Password policy: length is the primary factor (NIST 800-63B).
 * We require 10+ chars and reject the most common passwords.
 */
const COMMON_PASSWORDS = new Set([
  "password12",
  "password123",
  "qwerty12345",
  "1234567890",
  "iloveyou123",
  "letmein12345",
]);

export function passwordIssues(plain: string): string | null {
  if (plain.length < 10) return "Password must be at least 10 characters.";
  if (plain.length > 128) return "Password must be at most 128 characters.";
  if (COMMON_PASSWORDS.has(plain.toLowerCase())) return "This password is too common.";
  return null;
}
