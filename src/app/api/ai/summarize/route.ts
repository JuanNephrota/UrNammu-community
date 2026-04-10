import { NextRequest, NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { anthropic, AI_MODEL } from "@/lib/claude";
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

    const message = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `You are an AI compliance analyst. Analyze the compliance gaps for this AI system against the specified framework.

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
}`,
        },
      ],
    });

    const content = message.content[0];
    if (content.type !== "text") {
      return NextResponse.json({ error: "Unexpected response" }, { status: 500 });
    }

    try {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");
      const result = JSON.parse(jsonMatch[0]);
      return NextResponse.json(result);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse AI response", raw: content.text },
        { status: 500 }
      );
    }
  });
}
