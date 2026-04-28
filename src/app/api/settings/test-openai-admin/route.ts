import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { testOpenAIAdmin } from "@/lib/openai-admin";

export async function POST() {
  return withRole(["ADMIN"], async () => {
    const result = await testOpenAIAdmin();
    return NextResponse.json(result);
  });
}
