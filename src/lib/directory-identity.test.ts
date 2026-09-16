import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAliasMap,
  formatDepartmentRollup,
  isGraphGuestUser,
  mapGoogleDirectoryUser,
  mapGraphDirectoryUser,
  normalizeAliases,
  resolveAlias,
  rollupDepartments,
} from "./directory-identity";

test("Google users map to lower-cased primary + aliases, department, manager, org unit, and active flag", () => {
  const person = mapGoogleDirectoryUser({
    id: "g-1",
    primaryEmail: "Ada.Lovelace@Example.com",
    aliases: ["ada@example.com", "ADA.LOVELACE@example.com", "ada@example.com"],
    name: { fullName: "Ada Lovelace" },
    organizations: [{ department: "Engineering", title: "Staff Engineer", primary: true }],
    relations: [{ type: "manager", value: "Grace@Example.com" }],
    orgUnitPath: "/Engineering/Platform",
    suspended: false,
    archived: false,
  })!;
  assert.equal(person.source, "google_workspace");
  assert.equal(person.externalId, "g-1");
  assert.equal(person.primaryEmail, "ada.lovelace@example.com");
  // deduped, lower-cased, and the primary is excluded
  assert.deepEqual(person.aliases, ["ada@example.com"]);
  assert.equal(person.displayName, "Ada Lovelace");
  assert.equal(person.department, "Engineering");
  assert.equal(person.title, "Staff Engineer");
  assert.equal(person.managerEmail, "grace@example.com");
  assert.equal(person.orgUnit, "/Engineering/Platform");
  assert.equal(person.active, true);
});

test("suspended or archived Google users are inactive; rows without id/email are dropped", () => {
  assert.equal(mapGoogleDirectoryUser({ id: "g-2", primaryEmail: "x@example.com", suspended: true })!.active, false);
  assert.equal(mapGoogleDirectoryUser({ id: "g-3", primaryEmail: "y@example.com", archived: true })!.active, false);
  assert.equal(mapGoogleDirectoryUser({ id: "g-4", primaryEmail: "not-an-email" }), null);
  assert.equal(mapGoogleDirectoryUser({ primaryEmail: "z@example.com" }), null);
});

test("Graph users strip smtp: prefixes case-insensitively, exclude the primary, and read the manager", () => {
  const person = mapGraphDirectoryUser({
    id: "m-1",
    mail: "Bob@Contoso.com",
    userPrincipalName: "bob_contoso.com#EXT#@fabrikam.onmicrosoft.com",
    displayName: "Bob Builder",
    department: "Sales",
    jobTitle: "AE",
    accountEnabled: true,
    proxyAddresses: ["SMTP:Bob@Contoso.com", "smtp:bob.builder@contoso.com", "smtp:BOB@contoso.com", "x500:/o=Exchange"],
    officeLocation: "Seattle",
    manager: { mail: "Carol@Contoso.com" },
  })!;
  assert.equal(person.source, "microsoft_365");
  assert.equal(person.primaryEmail, "bob@contoso.com");
  assert.deepEqual(person.aliases, [
    "bob.builder@contoso.com",
    "bob_contoso.com#ext#@fabrikam.onmicrosoft.com",
  ]);
  assert.equal(person.department, "Sales");
  assert.equal(person.title, "AE");
  assert.equal(person.managerEmail, "carol@contoso.com");
  assert.equal(person.orgUnit, "Seattle");
  assert.equal(person.active, true);
});

test("Graph users fall back to the UPN when mail is empty and honour accountEnabled", () => {
  const person = mapGraphDirectoryUser({
    id: "m-2",
    mail: null,
    userPrincipalName: "Dee@Contoso.com",
    accountEnabled: false,
  })!;
  assert.equal(person.primaryEmail, "dee@contoso.com");
  assert.deepEqual(person.aliases, []);
  assert.equal(person.active, false);
  assert.equal(isGraphGuestUser({ userPrincipalName: "guest_gmail.com#EXT#@t.onmicrosoft.com" }), true);
  assert.equal(isGraphGuestUser({ userPrincipalName: "member@contoso.com" }), false);
});

test("alias map folds aliases onto the primary and leaves unknown emails alone", () => {
  const map = buildAliasMap([
    { primaryEmail: "ada@example.com", aliases: ["ada.lovelace@example.com"], active: true },
    { primaryEmail: "bob@example.com", aliases: [], active: false },
  ]);
  assert.equal(resolveAlias("ADA.LOVELACE@example.com", map), "ada@example.com");
  assert.equal(resolveAlias("ada@example.com", map), "ada@example.com");
  assert.equal(resolveAlias("stranger@example.com", map), "stranger@example.com");
  assert.equal(resolveAlias("user:42", map), null);
  assert.deepEqual(normalizeAliases(["A@x.io", "a@x.io", null, "primary@x.io"], "primary@x.io"), ["a@x.io"]);
});

test("department rollup counts distinct people per department and reports unmatched", () => {
  const rollup = rollupDepartments(
    ["ada@example.com", "ada.lovelace@example.com", "Bob@example.com", "carol@example.com", "nobody@example.com"],
    [
      { primaryEmail: "ada@example.com", aliases: ["ada.lovelace@example.com"], department: "Engineering", active: true },
      { primaryEmail: "bob@example.com", aliases: [], department: "Engineering", active: true },
      { primaryEmail: "carol@example.com", aliases: [], department: "Sales", active: true },
    ]
  );
  assert.deepEqual(rollup.entries, [
    { department: "Engineering", count: 2 },
    { department: "Sales", count: 1 },
  ]);
  assert.equal(rollup.unmatched, 1);
  assert.equal(formatDepartmentRollup(rollup), "Engineering 2 · Sales 1");
  assert.equal(
    formatDepartmentRollup({ entries: [{ department: "A", count: 3 }, { department: "B", count: 2 }, { department: "C", count: 1 }], unmatched: 0 }, 2),
    "A 3 · B 2 · +1 other"
  );
});
