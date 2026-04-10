import { NextRequest, NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { anthropic, AI_MODEL } from "@/lib/claude";
import { z } from "zod";

const requestSchema = z.object({
  name: z.string(),
  description: z.string(),
  useCase: z.string().optional(),
  vendor: z.string().optional(),
  modelType: z.string().optional(),
});

export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async () => {
    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }

    const { name, description, useCase, vendor, modelType } = parsed.data;

    const message = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are an AI governance risk analyst. Analyze this AI system and provide risk scores from 0-100 for each dimension (higher = more risk).

AI System:
- Name: ${name}
- Description: ${description}
- Use Case: ${useCase ?? "Not specified"}
- Vendor: ${vendor ?? "Not specified"}
- Model Type: ${modelType ?? "Not specified"}

Respond ONLY with valid JSON in this exact format:
{
  "biasScore": <0-100>,
  "securityScore": <0-100>,
  "privacyScore": <0-100>,
  "fairnessScore": <0-100>,
  "performanceScore": <0-100>,
  "transparencyScore": <0-100>,
  "riskLevel": "CRITICAL|HIGH|MEDIUM|LOW|MINIMAL",
  "reasoning": "<brief explanation>"
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
