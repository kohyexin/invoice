import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/* Prisma client singleton (server-side only). Cached on globalThis so dev
   hot-reloads don't exhaust the Neon connection pool. */

function createClient(): PrismaClient {
  // Neon drops idle connections and suspends the compute after a few quiet minutes; a pooled
  // socket it has closed hangs the next query, so retire idle ones early and fail fast.
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
