import { db } from "@/lib/db";

export async function GET() {
  let database = "ok";
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    database = "unreachable";
  }
  return Response.json({
    status: database === "ok" ? "healthy" : "degraded",
    database,
    timestamp: new Date().toISOString(),
  });
}
