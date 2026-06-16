import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { testGeminiBilling } from "@/lib/gemini-admin";

export async function POST() {
  return withRole(["ADMIN"], async () => {
    const result = await testGeminiBilling();
    return NextResponse.json(result);
  });
}
