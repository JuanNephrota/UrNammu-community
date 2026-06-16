import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getAuthOptions } from "./auth";

export type AuthSession = {
  user: {
    userId: string;
    role: string;
    department: string | null;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
};

export async function getSession(): Promise<AuthSession | null> {
  const session = await getServerSession(await getAuthOptions());
  if (!session?.user?.userId) return null;
  return session as AuthSession;
}

export async function requireAuth(): Promise<AuthSession> {
  const session = await getSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function requireRole(roles: string[]): Promise<AuthSession> {
  const session = await requireAuth();
  if (!roles.includes(session.user.role)) {
    throw new Error("Forbidden");
  }
  return session;
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbiddenResponse() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function withAuth(
  handler: (session: AuthSession) => Promise<NextResponse>
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  return handler(session);
}

export async function withRole(
  roles: string[],
  handler: (session: AuthSession) => Promise<NextResponse>
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  if (!roles.includes(session.user.role)) return forbiddenResponse();
  return handler(session);
}
