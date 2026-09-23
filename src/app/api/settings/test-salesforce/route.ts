import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { testSalesforceAgentforce } from "@/lib/salesforce-agentforce";

// POST /api/settings/test-salesforce — client-credentials token against the
// configured My Domain, then a COUNT() of BotDefinition (Agentforce agents).
export async function POST() {
  return withRole(["ADMIN"], async () => {
    const result = await testSalesforceAgentforce();
    return NextResponse.json(
      result.success ? { success: true, message: result.message } : { success: false, error: result.message }
    );
  });
}
