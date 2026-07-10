import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url && process.env.NODE_ENV === "production") {
    // Without this log the failure surfaces as an opaque ECONNREFUSED to
    // localhost on every query. Name the actual problem where the ops
    // logs will show it.
    console.error(
      "[db] DATABASE_URL is not set - every database query will fail. " +
        "Set it in the deployment environment (Vercel: Project Settings -> Environment Variables).",
    );
  }
  const adapter = new PrismaPg({
    connectionString: url || "postgresql://localhost:5432/tirvea",
  });
  if (process.env.PERF_TRACE) {
    const client = new PrismaClient({
      adapter,
      log: [{ level: "query", emit: "event" }, "error"],
    });
    client.$on("query", (e) => {
      console.info(`[trace:db] ${e.duration}ms at=${Date.now()} q=${e.query.slice(0, 80)}`);
    });
    return client;
  }
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
