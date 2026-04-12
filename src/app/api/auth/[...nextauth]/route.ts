import NextAuth from "next-auth";
import { getAuthOptions } from "@/lib/auth";

async function handler(request: Request, context: unknown) {
  return NextAuth(await getAuthOptions())(request, context);
}

export { handler as GET, handler as POST };
