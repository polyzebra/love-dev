import { z } from "zod";

/**
 * Environment contract. Server-only values must never be imported into
 * client components — this module is the single source of truth.
 */
/** Treat empty strings from .env templates as "not set". */
const optionalStr = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().optional(),
);

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: optionalStr,
  DIRECT_URL: optionalStr,
  AUTH_SECRET: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().min(32).optional(),
  ),
  AUTH_GOOGLE_ID: optionalStr,
  AUTH_GOOGLE_SECRET: optionalStr,
  AUTH_APPLE_ID: optionalStr,
  AUTH_APPLE_SECRET: optionalStr,
  STRIPE_SECRET_KEY: optionalStr,
  STRIPE_WEBHOOK_SECRET: optionalStr,
  RESEND_API_KEY: optionalStr,
  EMAIL_FROM: z.string().default("Amora <hello@amora.app>"),
  UPSTASH_REDIS_REST_URL: optionalStr,
  UPSTASH_REDIS_REST_TOKEN: optionalStr,
});

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
});

export const env = {
  ...serverSchema.parse(process.env),
  ...clientSchema.parse({ NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL }),
};

export const isProd = env.NODE_ENV === "production";
