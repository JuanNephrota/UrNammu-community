import { NextRequest, NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { generateAIResponse } from "@/lib/ai-provider";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const requestSchema = z.object({
  policyId: z.string(),
  aiSystemId: z.string(),
});

export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }

    const { policyId, aiSystemId } = parsed.data;

    // Fetch DB data first, then release the connection before the long AI call.
    // This prevents holding a DB connection open for 10+ seconds during inference.
    const [policy, system] = await Promise.all([
      prisma.policy.findUnique({ where: { id: policyId } }),
      prisma.aISystem.findUnique({ where: { id: aiSystemId } }),
    ]);

    if (!policy) return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    if (!system) return NextResponse.json({ error: "AI system not found" }, { status: 404 });

    // Snapshot the data we need so the connection can be returned to the pool
    const policyData = { name: policy.name, framework: policy.framework, version: policy.version, content: policy.content };
    const systemData = {
      name: system.name,
      description: system.description,
      useCase: system.useCase,
      vendor: system.vendor,
      modelType: system.modelType,
      dataInputs: system.dataInputs,
      dataOutputs: system.dataOutputs,
      dataSensitivity: system.dataSensitivity,
      riskLevel: system.riskLevel,
      status: system.status,
    };

    try {
      const text = await generateAIResponse(
        `You are an AI compliance auditor assessing whether an AI system meets the requirements of a governance policy. You have deep knowledge of compliance frameworks including the EU AI Act, NIST AI RMF, ISO 42001, and SOC 2. Always respond with valid JSON only, no markdown or commentary.`,
        `Assess whether the following AI system complies with this policy. Evaluate against the policy content below AND apply your knowledge of the ${policyData.framework.replace(/_/g, " ")} framework to identify any additional requirements that apply.

POLICY:
- Name: ${policyData.name}
- Framework: ${policyData.framework.replace(/_/g, " ")}
- Version: ${policyData.version}
- Content:
${policyData.content}

AI SYSTEM:
- Name: ${systemData.name}
- Description: ${systemData.description ?? "Not provided"}
- Use Case: ${systemData.useCase ?? "Not specified"}
- Vendor: ${systemData.vendor ?? "Not specified"}
- Model Type: ${systemData.modelType ?? "Not specified"}
- Data Inputs: ${systemData.dataInputs ?? "Not specified"}
- Data Outputs: ${systemData.dataOutputs ?? "Not specified"}
- Data Sensitivity: ${systemData.dataSensitivity}
- Current Risk Level: ${systemData.riskLevel}
- Status: ${systemData.status}

IMPORTANT CONTEXT — GOVERNANCE PLATFORM IN USE:
This AI system is registered in and actively governed through "Nammu", an enterprise AI governance and compliance platform. The following capabilities are ALREADY in place for this system and must NOT be flagged as gaps:
- Centralized AI system registry with ownership, versioning, and status tracking
- Multi-dimensional risk assessments (bias, security, privacy, fairness, performance, transparency) with scoring and justifications
- Policy management with assignment, compliance status tracking, and evidence documentation
- Full audit trail logging all governance actions (creates, updates, assessments, status changes)
- API usage monitoring and cost tracking across AI providers (Anthropic, OpenAI)
- Shadow AI discovery and detection (Google Workspace OAuth scanning, DNS/proxy log analysis)
- Role-based access control (Admin, Compliance Officer, Viewer)
- Automated and manual compliance assessment workflows
- Alert management for governance events
- Provider telemetry sync for usage oversight

Only flag gaps that are NOT addressed by the system's own properties or by the governance platform described above.

Assess the system against EACH requirement in the policy. Consider:
1. Does the system's description, use case, and data handling meet each policy requirement?
2. Are there gaps based on the framework's standard requirements that are NOT already covered by the governance platform?
3. What evidence supports compliance or non-compliance?

Respond ONLY with valid JSON in this exact format:
{
  "complianceStatus": "COMPLIANT" | "PARTIALLY_COMPLIANT" | "NON_COMPLIANT",
  "evidence": "<detailed reasoning explaining the assessment, covering key requirements met and unmet. 3-5 sentences.>",
  "gaps": [
    {
      "requirement": "<specific policy or framework requirement>",
      "finding": "<what is missing or insufficient>",
      "priority": "HIGH" | "MEDIUM" | "LOW"
    }
  ]
}`
      );

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in AI response");
      const result = JSON.parse(jsonMatch[0]);

      const validStatuses = ["COMPLIANT", "PARTIALLY_COMPLIANT", "NON_COMPLIANT"];
      const complianceStatus = validStatuses.includes(result.complianceStatus)
        ? result.complianceStatus
        : "NOT_ASSESSED";

      const gapsSummary = Array.isArray(result.gaps) && result.gaps.length > 0
        ? `\n\nGaps identified:\n${result.gaps.map((g: { requirement: string; finding: string; priority: string }) => `- [${g.priority}] ${g.requirement}: ${g.finding}`).join("\n")}`
        : "";

      const evidence = `[AI Assessment] ${result.evidence ?? "Assessment completed."}${gapsSummary}`;

      await prisma.policyAssignment.upsert({
        where: {
          policyId_aiSystemId: { policyId, aiSystemId },
        },
        update: {
          complianceStatus,
          evidence,
          assessedAt: new Date(),
        },
        create: {
          policyId,
          aiSystemId,
          complianceStatus,
          evidence,
          assessedAt: new Date(),
        },
      });

      await createAuditLog({
        userId: session.user.userId,
        action: "UPDATE",
        entityType: "Policy",
        entityId: policyId,
        changes: {
          type: "ai_compliance_assessment",
          aiSystemId,
          complianceStatus,
          gapsCount: result.gaps?.length ?? 0,
        },
      });

      return NextResponse.json({
        complianceStatus,
        evidence,
        gaps: result.gaps ?? [],
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "AI assessment failed" },
        { status: 500 }
      );
    }
  });
}
