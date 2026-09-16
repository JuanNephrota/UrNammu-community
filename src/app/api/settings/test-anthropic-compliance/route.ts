import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { testAnthropicCompliance } from "@/lib/anthropic-compliance";

export async function POST() {
  return withRole(["ADMIN"], async () => {
    const result = await testAnthropicCompliance();
    return NextResponse.json(result);
  });
}
