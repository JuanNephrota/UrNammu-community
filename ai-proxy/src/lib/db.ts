import { PrismaClient } from "@prisma/client";
import { writeProxyUsageBucket } from "./proxy-bucket-writer";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Azure Functions (Linux Node worker) runs many concurrent invocations on a
// single Node event loop per host instance — unlike Vercel's per-request
// isolate model. connection_limit=1 serializes every DB call across concurrent
// streaming completions and caused P2024 pool-timeout errors in production
// when multiple Anthropic streams finished simultaneously inside the same
// Node process (seen 2026-04-16T18:42: three logUsage failures within 30s).
//
// Azure Postgres nammu-db has max_connections=500 and typically serves ~8
// active host instances per day. connection_limit=5 gives each instance
// headroom for concurrent stream completions with plenty of room at scale
// (50 instances × 5 connections = 250, well under the 500 server cap).
function appendPoolLimit(url: string): string {
  if (!url) return url;
  const parts: string[] = [];
  if (!url.includes("connection_limit")) parts.push("connection_limit=5");
  if (!url.includes("pool_timeout")) parts.push("pool_timeout=15");
  if (parts.length === 0) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${parts.join("&")}`;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: appendPoolLimit(process.env.DATABASE_URL ?? "") } },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function logUsage(params: {
  provider: string;
  model: string;
  department: string | null;
  userEmail: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  flagged: boolean;
  flagCategory?: "upstream_error" | "proxy_error" | "prompt_risk" | null;
  flagReason?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    let userId: string | null = null;
    if (params.userEmail) {
      const user = await prisma.user.findUnique({
        where: { email: params.userEmail },
        select: { id: true },
      });
      userId = user?.id ?? null;
    }

    const aiSystemId =
      typeof (params.metadata as Record<string, unknown> | undefined)?.aiSystemId === "string"
        ? ((params.metadata as Record<string, unknown>).aiSystemId as string)
        : null;

    await prisma.aPIUsageLog.create({
      data: {
        provider: params.provider,
        model: params.model,
        department: params.department,
        aiSystemId,
        userId,
        promptTokens: params.promptTokens,
        completionTokens: params.completionTokens,
        totalTokens: params.totalTokens,
        cost: params.cost,
        flagged: params.flagged,
        flagCategory: params.flagCategory ?? null,
        flagReason: params.flagReason,
        promptMetadata: params.metadata
          ? JSON.parse(JSON.stringify(params.metadata))
          : undefined,
      },
    });

    // Mirror to normalized UsageBucket/CostBucket so proxy traffic appears on
    // the main Oversight dashboard immediately. See ./proxy-bucket-writer.ts.
    if (params.totalTokens > 0) {
      const normalizedProvider =
        params.provider === "claude"
          ? "anthropic"
          : params.provider === "chatgpt"
            ? "openai"
            : null;
      if (normalizedProvider) {
        await writeProxyUsageBucket({
          provider: normalizedProvider,
          model: params.model,
          userEmail: params.userEmail,
          department: params.department,
          promptTokens: params.promptTokens,
          completionTokens: params.completionTokens,
          totalTokens: params.totalTokens,
          cost: params.cost,
          aiSystemId,
        });
      }
    }
  } catch (err) {
    console.error("Failed to log API usage:", err);
  }
}

export async function logPolicyDenial(params: {
  provider: string;
  model: string;
  aiSystemId: string | null;
  userEmail: string | null;
  department: string | null;
  mode: "dryrun" | "enforced";
  policyIds: string[];
  reasons: Array<{ ruleKey: string; message: string; policyId: string; policyName: string }>;
  promptExcerpt: string | null;
  requestMetadata?: Record<string, unknown>;
}) {
  try {
    await prisma.policyDenial.create({
      data: {
        provider: params.provider,
        model: params.model,
        aiSystemId: params.aiSystemId,
        userEmail: params.userEmail,
        department: params.department,
        mode: params.mode,
        policyIds: params.policyIds,
        reasons: JSON.parse(JSON.stringify(params.reasons)),
        promptExcerpt: params.promptExcerpt,
        requestMetadata: params.requestMetadata
          ? JSON.parse(JSON.stringify(params.requestMetadata))
          : undefined,
      },
    });
  } catch (err) {
    console.error("Failed to log policy denial:", err);
  }
}
