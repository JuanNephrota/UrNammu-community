import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/auth-guard";
import { isCatalogFramework } from "@/lib/framework-catalog";

/**
 * GET /api/framework-controls[?framework=EU_AI_ACT]
 *
 * Read-only view of the seeded control catalog plus the crosswalk pairs that
 * touch the returned controls. The catalog is maintained by migration; there
 * is deliberately no write surface here.
 */
export async function GET(req: NextRequest) {
  return withAuth(async () => {
    const requested = req.nextUrl.searchParams.get("framework");
    if (requested && !isCatalogFramework(requested)) {
      return NextResponse.json({ error: "Unknown framework" }, { status: 400 });
    }
    const framework = requested && isCatalogFramework(requested) ? requested : null;

    const controls = await prisma.frameworkControl.findMany({
      where: framework ? { framework } : undefined,
      orderBy: [{ framework: "asc" }, { sortOrder: "asc" }],
    });
    const ids = controls.map((c) => c.id);
    const crosswalk = await prisma.controlCrosswalk.findMany({
      where: framework
        ? { OR: [{ fromControlId: { in: ids } }, { toControlId: { in: ids } }] }
        : undefined,
      include: {
        fromControl: { select: { id: true, framework: true, code: true, title: true } },
        toControl: { select: { id: true, framework: true, code: true, title: true } },
      },
    });

    return NextResponse.json({ controls, crosswalk });
  });
}
