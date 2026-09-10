import test from "node:test";
import assert from "node:assert/strict";
import type { JWT } from "next-auth/jwt";
import { hydrateJwtClaims, isActiveStatus } from "./auth";
import { prisma } from "./prisma";

function withStubbedUser(
  record: Record<string, unknown> | null,
  run: () => Promise<void>
) {
  const originalFindUnique = prisma.user.findUnique;
  prisma.user.findUnique = (async () =>
    record) as unknown as typeof prisma.user.findUnique;
  return run().finally(() => {
    prisma.user.findUnique = originalFindUnique;
  });
}

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

test("isActiveStatus only accepts ACTIVE", () => {
  assert.equal(isActiveStatus("ACTIVE"), true);
  assert.equal(isActiveStatus("SUSPENDED"), false);
  assert.equal(isActiveStatus("DELETED"), false);
  assert.equal(isActiveStatus(null), false);
});

test("hydrateJwtClaims revokes an existing token when the account is suspended", async () => {
  await withStubbedUser(
    { id: "user-1", role: "ADMIN", department: "Security", status: "SUSPENDED" },
    async () => {
      const token = {
        email: "person@example.com",
        role: "ADMIN",
        department: "Security",
        userId: "user-1",
      } as JWT;

      const hydrated = await hydrateJwtClaims(token);
      assert.equal(hydrated.status, "SUSPENDED");
      assert.equal(hydrated.userId, undefined);
      assert.equal(hydrated.role, undefined);
    }
  );
});

test("hydrateJwtClaims revokes a token whose account no longer resolves", async () => {
  await withStubbedUser(null, async () => {
    const token = {
      email: "gone@example.com",
      role: "ADMIN",
      department: null,
      userId: "user-1",
    } as JWT;

    const hydrated = await hydrateJwtClaims(token);
    assert.equal(hydrated.userId, undefined);
    assert.equal(hydrated.status, "DELETED");
  });
});

test("hydrateJwtClaims still trusts the provider user mid-sign-in", async () => {
  await withStubbedUser(null, async () => {
    const token = { email: "new@example.com" } as JWT;

    const hydrated = await hydrateJwtClaims(token, {
      id: "user-9",
      email: "new@example.com",
    });
    assert.equal(hydrated.userId, "user-9");
  });
});
