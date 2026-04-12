import { NextRequest, NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { generateAIResponse } from "@/lib/ai-provider";
import { z } from "zod";

const requestSchema = z.object({
  name: z.string(),
  description: z.string().nullish().transform((v) => v ?? "No description provided"),
  useCase: z.string().nullish(),
  vendor: z.string().nullish(),
  modelType: z.string().nullish(),
  dataInputs: z.string().nullish(),
  dataOutputs: z.string().nullish(),
  dataSensitivity: z.string().nullish(),
});

export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async () => {
    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }

    const { name, description, useCase, vendor, modelType, dataInputs, dataOutputs, dataSensitivity } = parsed.data;

    try {
      const text = await generateAIResponse(
        "You are an AI governance risk analyst performing risk assessments for AI systems. Always respond with valid JSON only, no markdown or commentary.",
        `Analyze this AI system and provide risk scores from 0-100 for each dimension (higher = more risk), with a specific justification for each score.

AI System Details:
- Name: ${name}
- Description: ${description}
- Use Case: ${useCase ?? "Not specified"}
- Vendor: ${vendor ?? "Not specified"}
- Model Type: ${modelType ?? "Not specified"}
- Data Inputs: ${dataInputs ?? "Not specified"}
- Data Outputs: ${dataOutputs ?? "Not specified"}
- Data Sensitivity: ${dataSensitivity ?? "Not specified"}

Risk Dimensions:
- biasScore: Potential for discriminatory outputs or decisions
- securityScore: Vulnerability to adversarial attacks, data breaches, prompt injection
- privacyScore: Risk of exposing personal or sensitive data
- fairnessScore: Unequal treatment across demographic groups
- performanceScore: Risk of unreliable or degraded outputs
- transparencyScore: Lack of explainability or interpretability

Respond ONLY with valid JSON in this exact format:
{
  "biasScore": <0-100>,
  "securityScore": <0-100>,
  "privacyScore": <0-100>,
  "fairnessScore": <0-100>,
  "performanceScore": <0-100>,
  "transparencyScore": <0-100>,
  "justifications": {
    "biasScore": "<2-3 sentence justification>",
    "securityScore": "<2-3 sentence justification>",
    "privacyScore": "<2-3 sentence justification>",
    "fairnessScore": "<2-3 sentence justification>",
    "performanceScore": "<2-3 sentence justification>",
    "transparencyScore": "<2-3 sentence justification>"
  },
  "notes": "<brief overall assessment summary>",
  "issues": [
    {
      "category": "<bias|security|privacy|fairness|performance|transparency|assessment_follow_up>",
      "title": "<short issue title>",
      "detail": "<specific issue detail>",
      "remediation": "<recommended next step>",
      "severity": "<CRITICAL|HIGH|MEDIUM|LOW|MINIMAL>"
    }
  ]
}`
      );

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in AI response");
      const result = JSON.parse(jsonMatch[0]);
      return NextResponse.json(result);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "AI generation failed" },
        { status: 500 }
      );
    }
  });
}
