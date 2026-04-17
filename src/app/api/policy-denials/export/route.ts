import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";
import { listBlockedEvents, type BlockedEventSource } from "@/lib/blocked-events";

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
    const sourceRaw = searchParams.get("source");
    const source: BlockedEventSource | undefined =
      sourceRaw === "policy" || sourceRaw === "content" ? sourceRaw : undefined;
    const aiSystemId = searchParams.get("aiSystemId") ?? "";
    const policyId = searchParams.get("policyId") ?? "";
    const since = parseDate(searchParams.get("since")) ?? defaultSince();
    const until = parseDate(searchParams.get("until")) ?? undefined;

    const MAX_ROWS = 10000;
    const { items } = await listBlockedEvents(
      {
        since,
        until,
        aiSystemId: aiSystemId || undefined,
        policyId: policyId || undefined,
        source,
      },
      { skip: 0, take: MAX_ROWS }
    );

    const systemIds = Array.from(
      new Set(items.map((i) => i.aiSystemId).filter((id): id is string => !!id))
    );
    const policyIds = Array.from(new Set(items.flatMap((i) => i.policyIds)));

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
      "source",
      "modeLabel",
      "provider",
      "model",
      "aiSystemId",
      "aiSystemName",
      "userEmail",
      "department",
      "policyIds",
      "policyNames",
      "reasonCount",
      "primaryReason",
    ];

    const lines = [toCsvRow(header)];
    for (const row of items) {
      lines.push(
        toCsvRow([
          row.id,
          row.createdAt.toISOString(),
          row.source,
          row.modeLabel,
          row.provider ?? "",
          row.model ?? "",
          row.aiSystemId ?? "",
          row.aiSystemId ? systemNames.get(row.aiSystemId) ?? "" : "",
          row.userEmail ?? "",
          row.department ?? "",
          row.policyIds.join("|"),
          row.policyIds.map((id) => policyNames.get(id) ?? id).join("|"),
          row.reasonCount,
          row.primaryReason,
        ])
      );
    }

    const csv = lines.join("\n");
    const filename = `blocked-queries-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });
}
