import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { testHelicone } from "@/lib/helicone-admin";

export async function POST() {
  return withRole(["ADMIN"], async () => {
    const result = await testHelicone();
    return NextResponse.json(result);
  });
}
