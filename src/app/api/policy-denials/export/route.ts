import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";

type Reason = { ruleKey: string; message: string; policyId: string; policyName: string };

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function defaultSince(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Standard RFC-4180 escaping: double-quotes-wrap if the cell contains a
// comma, quote, or newline, and escape inner quotes by doubling them.
function escapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map((cell) => escapeCell(String(cell ?? ""))).join(",");
}

export async function GET(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async () => {
    const { searchParams } = req.nextUrl;
    const mode = searchParams.get("mode");
    const modeFilter =
      mode === "dryrun" || mode === "enforced" ? mode : null;
    const aiSystemId = searchParams.get("aiSystemId") ?? "";
    const policyId = searchParams.get("policyId") ?? "";
    const since = parseDate(searchParams.get("since")) ?? defaultSince();
    const until = parseDate(searchParams.get("until"));

    const where: Prisma.PolicyDenialWhereInput = {
      createdAt: {
        gte: since,
        ...(until ? { lte: until } : {}),
      },
      ...(modeFilter ? { mode: modeFilter } : {}),
      ...(aiSystemId ? { aiSystemId } : {}),
      ...(policyId ? { policyIds: { has: policyId } } : {}),
    };

    // Safety cap — a CSV export shouldn't dump the entire table. If they
    // need more than this, they should narrow the window.
    const MAX_ROWS = 10000;
    const denials = await prisma.policyDenial.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
    });

    const systemIds = Array.from(
      new Set(denials.map((d) => d.aiSystemId).filter((id): id is string => !!id))
    );
    const policyIds = Array.from(
      new Set(denials.flatMap((d) => d.policyIds))
    );

    const [systems, policies] = await Promise.all([
      systemIds.length
        ? prisma.aISystem.findMany({
            where: { id: { in: systemIds } },
            select: { id: true, name: true },
          })
        : [],
      policyIds.length
        ? prisma.policy.findMany({
            where: { id: { in: policyIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);

    const systemNames = new Map(systems.map((s) => [s.id, s.name]));
    const policyNames = new Map(policies.map((p) => [p.id, p.name]));

    const header = [
      "id",
      "createdAt",
      "mode",
      "provider",
      "model",
      "aiSystemId",
      "aiSystemName",
      "userEmail",
      "department",
      "policyIds",
      "policyNames",
      "ruleKeys",
      "reasonCount",
      "firstReason",
    ];

    const lines = [toCsvRow(header)];
    for (const row of denials) {
      const reasons: Reason[] = Array.isArray(row.reasons)
        ? (row.reasons as unknown as Reason[])
        : [];
      lines.push(
        toCsvRow([
          row.id,
          row.createdAt.toISOString(),
          row.mode,
          row.provider,
          row.model ?? "",
          row.aiSystemId ?? "",
          row.aiSystemId ? systemNames.get(row.aiSystemId) ?? "" : "",
          row.userEmail ?? "",
          row.department ?? "",
          row.policyIds.join("|"),
          row.policyIds.map((id) => policyNames.get(id) ?? id).join("|"),
          reasons.map((r) => r.ruleKey).join("|"),
          reasons.length,
          reasons[0]?.message ?? "",
        ])
      );
    }

    const csv = lines.join("\n");
    const filename = `policy-denials-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });
}
