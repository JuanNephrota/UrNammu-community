import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { testOpenRouter } from "@/lib/openrouter-admin";

export async function POST() {
  return withRole(["ADMIN"], async () => {
    const result = await testOpenRouter();
    return NextResponse.json(result);
  });
}
