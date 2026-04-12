import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

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

    await prisma.aPIUsageLog.create({
      data: {
        provider: params.provider,
        model: params.model,
        department: params.department,
        userId,
        promptTokens: params.promptTokens,
        completionTokens: params.completionTokens,
        totalTokens: params.totalTokens,
        cost: params.cost,
        flagged: params.flagged,
        flagReason: params.flagReason,
        promptMetadata: params.metadata
          ? JSON.parse(JSON.stringify(params.metadata))
          : undefined,
      },
    });
  } catch (err) {
    console.error("Failed to log API usage:", err);
  }
}
