import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx prisma/seed.ts",
  },
  datasource: {
    // Use the pooled Supabase connection from .env
    url:
      process.env.DATABASE_URL ??
      "postgresql://localhost:5432/amora",
  },
});