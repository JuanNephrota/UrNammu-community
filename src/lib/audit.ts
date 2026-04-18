import { type Prisma } from "@prisma/client";
import { prisma } from "./prisma";

type AuditLogClient = {
  auditLog: {
    create: typeof prisma.auditLog.create;
  };
};

export async function createAuditLog(params: {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  aiSystemId?: string;
  agentId?: string;
  changes?: Prisma.InputJsonValue;
}, db: AuditLogClient = prisma) {
  return db.auditLog.create({
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
