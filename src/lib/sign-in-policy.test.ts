import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedSignInDomains,
  decideSsoSignIn,
  shouldPromoteInitialAdmin,
} from "./sign-in-policy";

const base = {
  provider: "google",
  email: "new@corp.com",
  emailVerified: true,
  accountExists: false,
  isProduction: true,
  allowedDomains: ["corp.com"],
  initialAdmin: null,
};

test("allowlist parsing trims, lowercases and strips @", () => {
  assert.deepEqual(
    allowedSignInDomains({ ALLOWED_SIGN_IN_DOMAINS: " Corp.com, @Sub.Corp.com ,," }),
    ["corp.com", "sub.corp.com"]
  );
});

test("new account on an allowlisted domain is allowed", () => {
  assert.equal(decideSsoSignIn(base).allowed, true);
});

test("new account on another domain is refused", () => {
  assert.equal(decideSsoSignIn({ ...base, email: "x@gmail.com" }).allowed, false);
});

test("lookalike domain does not match", () => {
  assert.equal(decideSsoSignIn({ ...base, email: "x@evilcorp.com" }).allowed, false);
  assert.equal(decideSsoSignIn({ ...base, email: "x@corp.com.evil.io" }).allowed, false);
});

test("unverified Google email is refused even for an existing account", () => {
  assert.equal(
    decideSsoSignIn({ ...base, emailVerified: false, accountExists: true }).allowed,
    false
  );
});

test("existing accounts are not blocked by the allowlist", () => {
  assert.equal(
    decideSsoSignIn({ ...base, email: "old@gmail.com", accountExists: true }).allowed,
    true
  );
});

test("production with no allowlist refuses new accounts", () => {
  assert.equal(decideSsoSignIn({ ...base, allowedDomains: [] }).allowed, false);
});

test("non-production with no allowlist stays open", () => {
  assert.equal(
    decideSsoSignIn({ ...base, allowedDomains: [], isProduction: false }).allowed,
    true
  );
});

test("the bootstrap admin may create their account without an allowlist", () => {
  assert.equal(
    decideSsoSignIn({ ...base, allowedDomains: [], initialAdmin: "new@corp.com" }).allowed,
    true
  );
});

test("initial admin is promoted only when no active admin exists", () => {
  const input = { email: "New@Corp.com", initialAdmin: "new@corp.com", activeAdminCount: 0 };
  assert.equal(shouldPromoteInitialAdmin(input), true);
  assert.equal(shouldPromoteInitialAdmin({ ...input, activeAdminCount: 1 }), false);
  assert.equal(shouldPromoteInitialAdmin({ ...input, email: "other@corp.com" }), false);
  assert.equal(shouldPromoteInitialAdmin({ ...input, initialAdmin: null }), false);
});
