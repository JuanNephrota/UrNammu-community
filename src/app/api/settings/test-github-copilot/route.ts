import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { testGitHubCopilot } from "@/lib/github-copilot-admin";

export async function POST() {
  return withRole(["ADMIN"], async () => {
    const result = await testGitHubCopilot();
    return NextResponse.json(result);
  });
}
