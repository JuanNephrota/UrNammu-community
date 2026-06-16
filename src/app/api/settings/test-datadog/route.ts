import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { testDatadog } from "@/lib/datadog-client";

export async function POST() {
  return withRole(["ADMIN"], async () => {
    const result = await testDatadog();
    return NextResponse.json(result);
  });
}
