import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { withRole } from "@/lib/auth-guard";
import { generateAIResponse } from "@/lib/ai-provider";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const requestSchema = z.object({
  agentId: z.string().min(1),
  name: z.string(),
  description: z.string().nullish().transform((v) => v ?? "No description provided"),
  autonomyLevel: z.string(),
  humanReviewRequired: z.boolean(),
  humanReviewTriggers: z.any().optional(),
  connectedSystems: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
  accessLevel: z.string().nullish(),
  department: z.string().nullish(),
  parentSystem: z
    .object({
      name: z.string(),
      riskLevel: z.string().nullish(),
      useCase: z.string().nullish(),
      dataSensitivity: z.string().nullish(),
      vendor: z.string().nullish(),
      modelType: z.string().nullish(),
    })
    .nullish(),
});

const responseSchema = z.object({
  recommendedRiskLevel: z.enum(["MINIMAL", "LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  reviewNeeded: z.boolean(),
  summary: z.string(),
  concerns: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
  scores: z.object({
    autonomy: z.number().min(0).max(100),
    oversight: z.number().min(0).max(100),
    blastRadius: z.number().min(0).max(100),
    changeRisk: z.number().min(0).max(100),
  }),
});

export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }

    const {
      agentId,
      name,
      description,
      autonomyLevel,
      humanReviewRequired,
      humanReviewTriggers,
      connectedSystems,
      capabilities,
      accessLevel,
      department,
      parentSystem,
    } = parsed.data;

    try {
      const agent = await prisma.aIAgent.findUnique({
        where: { id: agentId },
        select: { id: true, aiSystemId: true },
      });
      if (!agent) {
        return NextResponse.json({ error: "Agent not found" }, { status: 404 });
      }

      const text = await generateAIResponse(
        "You are an AI governance analyst evaluating operational agent risk. Always respond with valid JSON only, with concise and practical governance language.",
        `Analyze this AI agent and provide an agent-specific governance risk review.

Agent Details:
- Name: ${name}
- Description: ${description}
- Autonomy Level: ${autonomyLevel}
- Human Review Required: ${humanReviewRequired ? "Yes" : "No"}
- Human Review Triggers: ${JSON.stringify(humanReviewTriggers ?? [])}
- Connected Systems: ${connectedSystems?.join(", ") || "None documented"}
- Capabilities: ${capabilities?.join(", ") || "None documented"}
- Access Level: ${accessLevel ?? "Not specified"}
- Department: ${department ?? "Not specified"}

Parent System Context:
- Parent System: ${parentSystem?.name ?? "None linked"}
- Parent Risk Level: ${parentSystem?.riskLevel ?? "Unknown"}
- Parent Use Case: ${parentSystem?.useCase ?? "Not specified"}
- Parent Data Sensitivity: ${parentSystem?.dataSensitivity ?? "Not specified"}
- Parent Vendor: ${parentSystem?.vendor ?? "Not specified"}
- Parent Model Type: ${parentSystem?.modelType ?? "Not specified"}

Assess the agent across these agent-specific categories:
- autonomy: how risky the execution authority and automation level are
- oversight: how strong or weak the human-review and intervention model is
- blastRadius: how broad the downstream impact could be based on connected systems and capabilities
- changeRisk: how likely the agent is to drift away from the assumptions of the parent system governance

Respond ONLY with valid JSON in this exact format:
{
  "recommendedRiskLevel": "MINIMAL|LOW|MEDIUM|HIGH|CRITICAL",
  "reviewNeeded": true,
  "summary": "<2-4 sentence overall assessment>",
  "concerns": ["<concern 1>", "<concern 2>", "<concern 3>"],
  "recommendations": ["<action 1>", "<action 2>", "<action 3>"],
  "scores": {
    "autonomy": <0-100>,
    "oversight": <0-100>,
    "blastRadius": <0-100>,
    "changeRisk": <0-100>
  }
}`
      );

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in AI response");
      const raw = JSON.parse(jsonMatch[0]);
      const result = responseSchema.parse(raw);

      const review = await prisma.agentRiskReview.create({
        data: {
          agentId: agent.id,
          recommendedRiskLevel: result.recommendedRiskLevel,
          reviewNeeded: result.reviewNeeded,
          summary: result.summary,
          concerns: result.concerns as Prisma.InputJsonValue,
          recommendations: result.recommendations as Prisma.InputJsonValue,
          scores: result.scores as Prisma.InputJsonValue,
          generatedBy: session.user.name ?? session.user.email ?? "Unknown",
        },
      });

      await createAuditLog({
        userId: session.user.userId,
        action: "CREATE",
        entityType: "AgentRiskReview",
        entityId: review.id,
        aiSystemId: agent.aiSystemId ?? undefined,
        agentId: agent.id,
        changes: {
          recommendedRiskLevel: review.recommendedRiskLevel,
          reviewNeeded: review.reviewNeeded,
        },
      });

      return NextResponse.json({
        ...result,
        id: review.id,
        createdAt: review.createdAt,
        generatedBy: review.generatedBy,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "AI agent risk assessment failed" },
        { status: 500 }
      );
    }
  });
}
