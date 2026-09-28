import "dotenv/config";
import { defineConfig } from "prisma/config";

// Migrations need the DIRECT (non-pooled) Neon URL; the app uses the pooled
// DATABASE_URL via lib/db.ts. The placeholder keeps `prisma generate`
// working where no database is configured.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url:
      process.env.DIRECT_URL ??
      "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
