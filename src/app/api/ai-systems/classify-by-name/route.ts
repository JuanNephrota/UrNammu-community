import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/auth-guard";
import { classifyDiscoveredTool } from "@/lib/ai-classification";

const classifyByNameSchema = z.object({
  name: z.string().trim().min(1).max(200),
  vendor: z.string().trim().max(200).optional().nullable(),
  department: z.string().trim().max(200).optional().nullable(),
});

/**
 * Manually-triggered classification for the AI System registration form.
 * Accepts just the system name (and optionally vendor/department) and
 * returns inferred fields: description, useCase, modelType, data
 * inputs/outputs, riskLevel, dataSensitivity, plus a short reasoning.
 *
 * Returns null values for any field the model couldn't confidently fill
 * so the client can conditionally populate only the filled ones. When the
 * AI provider isn't configured or the call fails, responds with 503 so
 * the client can show a clear error.
 */
export async function POST(req: NextRequest) {
  return withAuth(async () => {
    const body = await req.json().catch(() => null);
    const parsed = classifyByNameSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = await classifyDiscoveredTool({
      toolName: parsed.data.name,
      vendor: parsed.data.vendor ?? null,
      department: parsed.data.department ?? null,
      detectedDomain: null,
      notes: null,
    });

    if (!result) {
      return NextResponse.json(
        {
          error:
            "AI classification unavailable. Ensure the AI provider API key is configured in Settings > General.",
        },
        { status: 503 }
      );
    }

    return NextResponse.json(result);
  });
}
