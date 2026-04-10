import { type Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export async function createAuditLog(params: {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  aiSystemId?: string;
  agentId?: string;
  changes?: Prisma.InputJsonValue;
}) {
  return prisma.auditLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      aiSystemId: params.aiSystemId,
      agentId: params.agentId,
      changes: params.changes,
    },
  });
}
