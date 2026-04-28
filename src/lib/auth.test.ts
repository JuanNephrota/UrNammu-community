import test from "node:test";
import assert from "node:assert/strict";
import type { JWT } from "next-auth/jwt";
import { hydrateJwtClaims } from "./auth";
import { prisma } from "./prisma";

test("hydrateJwtClaims refreshes role and department from the database", async () => {
  const originalFindUnique = prisma.user.findUnique;

  prisma.user.findUnique = (async () => ({
    id: "user-1",
    role: "VIEWER",
    department: "Legal",
  })) as unknown as typeof prisma.user.findUnique;

  try {
    const token = {
      email: "person@example.com",
      role: "ADMIN",
      department: "Security",
      userId: "user-1",
    } as JWT;

    const hydrated = await hydrateJwtClaims(token);
    assert.equal(hydrated.role, "VIEWER");
    assert.equal(hydrated.department, "Legal");
    assert.equal(hydrated.userId, "user-1");
  } finally {
    prisma.user.findUnique = originalFindUnique;
  }
});
