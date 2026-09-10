import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Account lifecycle rules shared by the users API and the settings page.
 *
 * Deletion is a retirement, not a row removal: `AuditLog`, `SystemApproval`,
 * `GovernanceReview`, `GovernanceException`, `EvidenceArtifact`,
 * `GovernanceIncident`, and `ReportDefinition` all cascade off `User`, so
 * dropping the row would erase the governance trail the platform exists to
 * keep. Instead the row survives with its identifying fields scrubbed, its
 * credentials and OAuth links removed, and a terminal DELETED status that no
 * sign-in path accepts.
 */

export const DELETED_USER_NAME = "Deleted user";
export const DELETED_EMAIL_DOMAIN = "deleted.invalid";

/**
 * Frees the real address for reuse (the column is unique) while staying
 * unique itself and unusable as a login.
 */
export function anonymizedEmail(userId: string): string {
  return `deleted-${userId}@${DELETED_EMAIL_DOMAIN}`;
}

export const managedUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  department: true,
  createdAt: true,
  passwordHash: true,
  status: true,
  statusReason: true,
  suspendedAt: true,
  deletedAt: true,
  accounts: { select: { provider: true } },
} satisfies Prisma.UserSelect;

type ManagedUserRecord = Prisma.UserGetPayload<{ select: typeof managedUserSelect }>;

export type ManagedUserPayload = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  department: string | null;
  createdAt: Date;
  hasLocalPassword: boolean;
  authProviders: string[];
  status: string;
  statusReason: string | null;
  suspendedAt: Date | null;
  deletedAt: Date | null;
};

export function serializeManagedUser(user: ManagedUserRecord): ManagedUserPayload {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    createdAt: user.createdAt,
    hasLocalPassword: !!user.passwordHash,
    authProviders: user.accounts.map((account) => account.provider),
    status: user.status,
    statusReason: user.statusReason,
    suspendedAt: user.suspendedAt,
    deletedAt: user.deletedAt,
  };
}

/**
 * Scrubs identity, revokes credentials, and drops every live session and OAuth
 * link in one transaction, so the account cannot be signed into again through
 * any provider.
 */
export async function retireUser(userId: string, reason: string | null) {
  return prisma.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { userId } });
    await tx.account.deleteMany({ where: { userId } });

    return tx.user.update({
      where: { id: userId },
      data: {
        status: "DELETED",
        statusReason: reason,
        deletedAt: new Date(),
        suspendedAt: null,
        email: anonymizedEmail(userId),
        name: DELETED_USER_NAME,
        image: null,
        department: null,
        passwordHash: null,
        emailVerified: null,
      },
      select: managedUserSelect,
    });
  });
}
