import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { testCursorAdmin } from "@/lib/cursor-admin";

export async function POST() {
  return withRole(["ADMIN"], async () => {
    const result = await testCursorAdmin();
    return NextResponse.json(result);
  });
}
