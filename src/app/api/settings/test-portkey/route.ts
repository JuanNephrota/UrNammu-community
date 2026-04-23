import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { testPortkey } from "@/lib/portkey-admin";

export async function POST() {
  return withRole(["ADMIN"], async () => {
    const result = await testPortkey();
    return NextResponse.json(result);
  });
}
