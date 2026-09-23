import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { testMicrosoftCopilotAgents } from "@/lib/microsoft-copilot-agents";

// POST /api/settings/test-microsoft-copilot-agents — reads the first page of
// Copilot agent packages with the Microsoft 365 app registration. Fails with
// a permission hint until CopilotPackages.Read.All has admin consent.
export async function POST() {
  return withRole(["ADMIN"], async () => {
    const result = await testMicrosoftCopilotAgents();
    return NextResponse.json(
      result.success ? { success: true, message: result.message } : { success: false, error: result.message }
    );
  });
}
