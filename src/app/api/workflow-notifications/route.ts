import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { buildWorkflowNotifications } from "@/lib/workflow-notifications";

export async function GET() {
  return withAuth(async () => {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      recentApprovals,
      expiringExceptions,
      driftAlerts,
      openIncidents,
      overdueReviews,
      investigations,
    ] = await Promise.all([
      prisma.systemApproval.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { aiSystem: { select: { name: true } } },
      }),
      prisma.governanceException.findMany({
        where: { status: "ACTIVE", expiresAt: { lte: sevenDaysFromNow, gte: now } },
        orderBy: { expiresAt: "asc" },
        take: 5,
        include: { aiSystem: { select: { name: true } } },
      }),
      prisma.alert.findMany({
        where: { source: "system_drift", status: { in: ["OPEN", "ACKNOWLEDGED"] } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.governanceIncident.findMany({
        where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
        orderBy: { openedAt: "desc" },
        take: 5,
        include: { aiSystem: { select: { name: true } } },
      }),
      prisma.aISystem.findMany({
        where: { nextReviewDate: { lt: now } },
        orderBy: { nextReviewDate: "asc" },
        take: 5,
        select: { id: true, name: true, nextReviewDate: true },
      }),
      prisma.investigation.findMany({
        where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
    ]);

    const notifications = buildWorkflowNotifications({
      recentApprovals: recentApprovals.map((approval) => ({
        id: approval.id,
        systemName: approval.aiSystem.name,
        decision: approval.decision,
        createdAt: approval.createdAt,
      })),
      expiringExceptions: expiringExceptions.map((exception) => ({
        id: exception.id,
        systemName: exception.aiSystem.name,
        expiresAt: exception.expiresAt,
      })),
      driftAlerts: driftAlerts.map((alert) => ({
        id: alert.id,
        title: alert.title,
        createdAt: alert.createdAt,
      })),
      openIncidents: openIncidents.map((incident) => ({
        id: incident.id,
        systemName: incident.aiSystem.name,
        title: incident.title,
        openedAt: incident.openedAt,
      })),
      overdueReviews: overdueReviews.map((system) => ({
        id: system.id,
        systemName: system.name,
        nextReviewDate: system.nextReviewDate ?? now,
      })),
      investigations: investigations.map((investigation) => ({
        id: investigation.id,
        title: investigation.title,
        updatedAt: investigation.updatedAt,
      })),
    });

    return NextResponse.json(notifications);
  });
}
