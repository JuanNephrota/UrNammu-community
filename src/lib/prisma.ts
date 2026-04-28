import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  datasources: {
    db: {
      // Append connection_limit if not already in the URL to prevent
      // connection pool exhaustion in Vercel's serverless environment.
      url: appendPoolLimit(process.env.DATABASE_URL ?? ""),
    },
  },
});

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

function appendPoolLimit(url: string): string {
  if (!url) return url;
  const parts: string[] = [];
  if (!url.includes("connection_limit")) {
    // Vercel serverless: each concurrent invocation runs in its own isolate.
    // With a 100-connection cap on Azure Postgres B1ms, we need connection_limit=1
    // so 100 concurrent invocations can each get 1 connection (plus admin headroom).
    parts.push("connection_limit=1");
  }
  if (!url.includes("pool_timeout")) {
    // Fail fast when pool is contended so request retries can happen at the edge
    // instead of piling up on an exhausted server.
    parts.push("pool_timeout=15");
  }
  if (parts.length === 0) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${parts.join("&")}`;
}
