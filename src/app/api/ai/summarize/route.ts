import { NextRequest, NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { generateAIResponse } from "@/lib/ai-provider";
import { z } from "zod";

const requestSchema = z.object({
  systemName: z.string(),
  framework: z.string(),
  currentMappings: z.array(
    z.object({
      requirement: z.string(),
      status: z.string(),
    })
  ),
});

export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async () => {
    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }

    const { systemName, framework, currentMappings } = parsed.data;

    try {
      const text = await generateAIResponse(
        "You are an AI compliance analyst. Always respond with valid JSON only, no markdown or commentary.",
        `Analyze the compliance gaps for this AI system against the specified framework.

AI System: ${systemName}
Framework: ${framework}

Current Compliance Mappings:
${currentMappings.map((m) => `- ${m.requirement}: ${m.status}`).join("\n")}

Respond ONLY with valid JSON:
{
  "gaps": [
    {
      "requirement": "<requirement name>",
      "gap": "<what's missing>",
      "remediation": "<suggested fix>",
      "priority": "HIGH|MEDIUM|LOW"
    }
  ],
  "overallAssessment": "<brief summary>",
  "complianceScore": <0-100>
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
