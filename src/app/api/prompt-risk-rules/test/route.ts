import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { analyzePromptRisk } from "@/lib/prompt-risk";
import { z } from "zod";

const testSchema = z.object({
  prompt: z.string().min(1).max(8000),
});

/**
 * Dry-run a prompt against the current active rule set. Used by the
 * management UI's "Test prompt" panel so operators can see which rules
 * would fire before enabling them in production.
 *
 * Wraps the prompt as a `user` message so the normal extractor runs
 * unchanged — which means all of the anti-false-positive guards
 * (tool_use / tool_result / system prompts are skipped) apply here too.
 */
export async function POST(req: NextRequest) {
  return withAuth(async () => {
    const body = await req.json();
    const parsed = testSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = await analyzePromptRisk({
      messages: [{ role: "user", content: parsed.data.prompt }],
    });

    return NextResponse.json(result);
  });
}
