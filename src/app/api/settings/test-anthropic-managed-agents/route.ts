import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { testAnthropicManagedAgents } from "@/lib/anthropic-managed-agents";

// POST /api/settings/test-anthropic-managed-agents — lists one agent with the
// stored workspace API key (GET /v1/agents?limit=1).
export async function POST() {
  return withRole(["ADMIN"], async () => {
    const result = await testAnthropicManagedAgents();
    return NextResponse.json(
      result.success ? { success: true, message: result.message } : { success: false, error: result.message }
    );
  });
}
