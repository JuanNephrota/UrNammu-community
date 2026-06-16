import { NextRequest, NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async () => {
    const format = req.nextUrl.searchParams.get("format") ?? "json";
    const [systems, openAlerts, activeExceptions, incidents] = await Promise.all([
      prisma.aISystem.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          owner: { select: { name: true, email: true } },
          policyAssignments: { select: { complianceStatus: true } },
          governanceExceptions: { where: { status: "ACTIVE" } },
          alerts: { where: { status: "OPEN" } },
        },
      }),
      prisma.alert.count({ where: { status: "OPEN" } }),
      prisma.governanceException.count({ where: { status: "ACTIVE", expiresAt: { gte: new Date() } } }),
      prisma.governanceIncident.count({ where: { status: "OPEN" } }),
    ]);

    const report = {
      generatedAt: new Date().toISOString(),
      summary: {
        systems: systems.length,
        openAlerts,
        activeExceptions,
        openIncidents: incidents,
      },
      systems: systems.map((system) => ({
        id: system.id,
        name: system.name,
        department: system.department,
        owner: system.owner.name ?? system.owner.email,
        status: system.status,
        riskLevel: system.riskLevel,
        nextReviewDate: system.nextReviewDate,
        openAlerts: system.alerts.length,
        activeExceptions: system.governanceExceptions.length,
        compliantAssignments: system.policyAssignments.filter((a) => a.complianceStatus === "COMPLIANT").length,
        totalAssignments: system.policyAssignments.length,
      })),
    };

    if (format === "csv") {
      const header = ["id", "name", "department", "owner", "status", "riskLevel", "nextReviewDate", "openAlerts", "activeExceptions", "compliantAssignments", "totalAssignments"];
      const rows = report.systems.map((system) =>
        [
          system.id,
          system.name,
          system.department,
          system.owner,
          system.status,
          system.riskLevel,
          system.nextReviewDate ? new Date(system.nextReviewDate).toISOString() : "",
          String(system.openAlerts),
          String(system.activeExceptions),
          String(system.compliantAssignments),
          String(system.totalAssignments),
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(",")
      );
      return new NextResponse([header.join(","), ...rows].join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="governance-summary.csv"',
        },
      });
    }

    return NextResponse.json(report);
  });
}
