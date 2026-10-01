import test from "node:test";
import assert from "node:assert/strict";
import type { AuthSession } from "@/lib/auth-guard";
import { canQueryDataSource } from "./access";

const as = (role: string) =>
  ({ user: { userId: "u", role, department: null } }) as AuthSession;

test("VIEWER cannot query person-level report sources", () => {
  for (const source of ["AUDIT_LOG", "PEOPLE_USAGE", "API_USAGE"]) {
    assert.equal(canQueryDataSource(source, as("VIEWER")), false, source);
    assert.equal(canQueryDataSource(source, as("COMPLIANCE_OFFICER")), true, source);
    assert.equal(canQueryDataSource(source, as("ADMIN")), true, source);
  }
});

test("VIEWER can still query aggregate sources", () => {
  assert.equal(canQueryDataSource("AI_SYSTEMS", as("VIEWER")), true);
  assert.equal(canQueryDataSource("COMPLIANCE", as("VIEWER")), true);
});
