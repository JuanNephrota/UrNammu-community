import { prisma } from "@/lib/prisma";
import type { AuthSession } from "@/lib/auth-guard";

const AUTHOR_ROLES = ["ADMIN", "COMPLIANCE_OFFICER"];

// Max stored artifact size for run history (5 MB). Larger artifacts are still
// streamed to the requester but not persisted for later re-download.
export const MAX_STORED_ARTIFACT_BYTES = 5 * 1024 * 1024;

export async function loadDefinition(id: string) {
  return prisma.reportDefinition.findUnique({ where: { id } });
}

export function canView(
  definition: { ownerId: string; visibility: string },
  session: AuthSession
): boolean {
  return (
    definition.visibility === "SHARED" ||
    definition.ownerId === session.user.userId ||
    session.user.role === "ADMIN"
  );
}

export function canMutate(
  definition: { ownerId: string },
  session: AuthSession
): boolean {
  return (
    definition.ownerId === session.user.userId ||
    AUTHOR_ROLES.includes(session.user.role)
  );
}

export function isAuthor(session: AuthSession): boolean {
  return AUTHOR_ROLES.includes(session.user.role);
}
