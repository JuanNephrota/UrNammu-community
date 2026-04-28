import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { testAnthropicAdmin } from "@/lib/anthropic-admin";

export async function POST() {
  return withRole(["ADMIN"], async () => {
    const result = await testAnthropicAdmin();
    return NextResponse.json(result);
  });
}
