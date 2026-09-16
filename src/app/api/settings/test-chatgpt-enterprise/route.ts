import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { testChatGPTEnterprise } from "@/lib/chatgpt-enterprise-admin";

export async function POST() {
  return withRole(["ADMIN"], async () => {
    const result = await testChatGPTEnterprise();
    return NextResponse.json(result);
  });
}
