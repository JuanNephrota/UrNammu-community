import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./passwords";

test("password hashes verify successfully", async () => {
  const passwordHash = await hashPassword("super-secret-password");

  assert.equal(await verifyPassword("super-secret-password", passwordHash), true);
  assert.equal(await verifyPassword("wrong-password", passwordHash), false);
});
