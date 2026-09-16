import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { testClaudeEnterprise } from "@/lib/claude-enterprise-analytics";

export async function POST() {
  return withRole(["ADMIN"], async () => {
    const result = await testClaudeEnterprise();
    return NextResponse.json(result);
  });
}
