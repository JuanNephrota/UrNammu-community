import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { testLiteLLM } from "@/lib/litellm-admin";

export async function POST() {
  return withRole(["ADMIN"], async () => {
    const result = await testLiteLLM();
    return NextResponse.json(result);
  });
}
