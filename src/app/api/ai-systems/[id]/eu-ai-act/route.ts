import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { saveEuAiActClassificationSchema } from "@/lib/validations/eu-ai-act";
import {
  TIER_LABELS,
  checkCompleteness,
  classifyEuAiAct,
  normalizeAnswers,
  type EuAiActAnswers,
} from "@/lib/eu-ai-act";
import { EU_AI_ACT_ALERT_SOURCE } from "@/lib/eu-ai-act-data";

/**
 * GET /api/ai-systems/[id]/eu-ai-act
 * The stored classification (or null) plus the result re-derived from its
 * answers, so callers can see whether the logic has moved since it was saved.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async () => {
    const { id } = await params;
    const classification = await prisma.euAiActClassification.findUnique({
      where: { aiSystemId: id },
      include: { classifiedByUser: { select: { name: true, email: true } } },
    });
    if (!classification) return NextResponse.json({ classification: null, result: null });
    const answers = normalizeAnswers(classification.answers);
    return NextResponse.json({ classification, answers, result: classifyEuAiAct(answers) });
  });
}

/**
 * POST /api/ai-systems/[id]/eu-ai-act
 * Body: { answers, notes?, reviewDueAt? }
 *
 * Re-derives the classification server-side (the client's preview is never
 * trusted), upserts it, pre-creates NOT_ASSESSED ComplianceMapping rows for
 * every applicable EU AI Act article that the system has not been assessed
 * against yet, and raises/resolves the `eu_ai_act` alert for prohibited and
 * high-risk outcomes.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = saveEuAiActClassificationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const answers: EuAiActAnswers = {
      ...parsed.data.answers,
      providesGpai: parsed.data.answers.providesGpai ?? false,
    };
    const completeness = checkCompleteness(answers);
    if (!completeness.complete) {
      return NextResponse.json(
        { error: "Classification is incomplete", missing: completeness.missing },
        { status: 400 }
      );
    }

    const system = await prisma.aISystem.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!system) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const result = classifyEuAiAct(answers);
    const [existing, euControls] = await Promise.all([
      prisma.euAiActClassification.findUnique({
        where: { aiSystemId: id },
        select: { id: true, tier: true, role: true, applicableArticles: true },
      }),
      prisma.frameworkControl.findMany({
        where: { framework: "EU_AI_ACT", code: { in: result.applicableArticles } },
        select: { id: true, code: true, title: true },
      }),
    ]);
    const alreadyMapped = new Set(
      (
        await prisma.complianceMapping.findMany({
          where: { aiSystemId: id, controlId: { in: euControls.map((c) => c.id) } },
          select: { controlId: true },
        })
      ).map((m) => m.controlId)
    );
    const missingControls = euControls.filter((c) => !alreadyMapped.has(c.id));

    const data = {
      role: result.role,
      tier: result.tier,
      annexIProduct: result.annexIProduct,
      annexIiiCategories: result.annexIIICategories,
      derogationClaimed: result.derogationClaimed,
      transparencyRequired: result.transparencyRequired,
      friaRequired: result.friaRequired,
      gpaiDeployer: result.gpaiDeployer,
      gpaiProvider: result.gpaiProvider,
      applicableArticles: result.applicableArticles,
      answers: answers as unknown as Prisma.InputJsonValue,
      rationale: result.rationale.join("\n"),
      notes: parsed.data.notes || null,
      obligationDeadline: result.deadline ? new Date(`${result.deadline.date}T00:00:00Z`) : null,
      classifiedByUserId: session.user.userId,
      classifiedAt: new Date(),
      reviewDueAt: parsed.data.reviewDueAt ? new Date(parsed.data.reviewDueAt) : null,
    };

    const classification = await prisma.$transaction(async (tx) => {
      const saved = await tx.euAiActClassification.upsert({
        where: { aiSystemId: id },
        update: data,
        create: { aiSystemId: id, ...data },
      });

      if (missingControls.length > 0) {
        await tx.complianceMapping.createMany({
          data: missingControls.map((c) => ({
            aiSystemId: id,
            controlId: c.id,
            framework: "EU_AI_ACT" as const,
            requirement: `${c.code} — ${c.title}`,
            status: "NOT_ASSESSED" as const,
          })),
          skipDuplicates: true,
        });
      }

      const openAlert = await tx.alert.findFirst({
        where: {
          source: EU_AI_ACT_ALERT_SOURCE,
          aiSystemId: id,
          status: { in: ["OPEN", "ACKNOWLEDGED"] },
        },
        select: { id: true },
      });
      const escalate = result.tier === "PROHIBITED" || result.tier === "HIGH_RISK";
      if (escalate) {
        const alertData = {
          title:
            result.tier === "PROHIBITED"
              ? `EU AI Act: prohibited practice identified — ${system.name}`
              : `EU AI Act: high-risk system — ${system.name}`,
          description:
            result.tier === "PROHIBITED"
              ? `${result.rationale[0]} Withdraw or redesign before any use in the EU.`
              : `${result.rationale[0]} ${result.applicableArticles.length} articles apply; ${missingControls.length} new obligation mappings were created for assessment on the Compliance tab.`,
          severity: result.tier === "PROHIBITED" ? ("CRITICAL" as const) : ("HIGH" as const),
        };
        if (openAlert) {
          await tx.alert.update({ where: { id: openAlert.id }, data: alertData });
        } else {
          await tx.alert.create({
            data: { ...alertData, source: EU_AI_ACT_ALERT_SOURCE, aiSystemId: id },
          });
        }
      } else if (openAlert) {
        await tx.alert.update({ where: { id: openAlert.id }, data: { status: "RESOLVED" } });
      }

      await createAuditLog(
        {
          userId: session.user.userId,
          action: existing ? "UPDATE" : "CREATE",
          entityType: "EuAiActClassification",
          entityId: saved.id,
          aiSystemId: id,
          changes: {
            before: existing
              ? { tier: existing.tier, role: existing.role, applicableArticles: existing.applicableArticles }
              : null,
            after: {
              tier: saved.tier,
              tierLabel: TIER_LABELS[saved.tier],
              role: saved.role,
              applicableArticles: saved.applicableArticles,
            },
            mappingsCreated: missingControls.map((c) => c.code),
          },
        },
        tx
      );

      return saved;
    });

    return NextResponse.json({
      classification,
      result,
      mappingsCreated: missingControls.map((c) => c.code),
    });
  });
}
