import test from "node:test";
import assert from "node:assert/strict";
import { broadScopes, describeScope, describeScopes, hasScopeAccess, summariseScopeAccess } from "./oauth-scopes";

const G = "https://www.googleapis.com/auth/";

test("Google scopes get a category, an access level and a plain label", () => {
  assert.deepEqual(pick(describeScope(`${G}gmail.readonly`)), ["mail", "read", "Email (read)", true]);
  assert.deepEqual(pick(describeScope(`${G}gmail.send`)), ["mail", "write", "Email (read/write)", true]);
  assert.deepEqual(pick(describeScope("https://mail.google.com/")), ["mail", "full", "Email (full)", true]);
  assert.deepEqual(pick(describeScope(`${G}calendar.events.readonly`)), ["calendar", "read", "Calendar (read)", true]);
  assert.deepEqual(pick(describeScope(`${G}calendar`)), ["calendar", "write", "Calendar (read/write)", true]);
  assert.deepEqual(pick(describeScope(`${G}drive.readonly`)), ["files", "read", "Files & docs (read)", true]);
  assert.deepEqual(pick(describeScope(`${G}spreadsheets`)), ["files", "write", "Files & docs (read/write)", true]);
  assert.deepEqual(pick(describeScope(`${G}contacts.readonly`)), ["contacts", "read", "Contacts (read)", true]);
  assert.deepEqual(pick(describeScope(`${G}admin.directory.user.readonly`)), ["directory", "read", "Directory (read)", true]);
  assert.deepEqual(pick(describeScope(`${G}admin.reports.audit.readonly`)), ["admin", "read", "Admin (read)", true]);
  assert.deepEqual(pick(describeScope(`${G}cloud-platform`)), ["cloud", "write", "Cloud platform (read/write)", true]);
});

test("Microsoft Graph scopes are recognised with or without the resource prefix", () => {
  assert.deepEqual(pick(describeScope("Mail.Read")), ["mail", "read", "Email (read)", true]);
  assert.deepEqual(pick(describeScope("Mail.ReadWrite")), ["mail", "write", "Email (read/write)", true]);
  assert.deepEqual(pick(describeScope("Mail.Send")), ["mail", "write", "Email (read/write)", true]);
  assert.deepEqual(pick(describeScope("IMAP.AccessAsUser.All")), ["mail", "full", "Email (full)", true]);
  assert.deepEqual(pick(describeScope("https://graph.microsoft.com/Files.Read.All")), ["files", "read", "Files & docs (read)", true]);
  assert.deepEqual(pick(describeScope("Sites.ReadWrite.All")), ["files", "write", "Files & docs (read/write)", true]);
  assert.deepEqual(pick(describeScope("Calendars.Read")), ["calendar", "read", "Calendar (read)", true]);
  assert.deepEqual(pick(describeScope("Directory.Read.All")), ["directory", "read", "Directory (read)", true]);
  assert.deepEqual(pick(describeScope("User.Read.All")), ["directory", "read", "Directory (read)", true]);
  assert.deepEqual(pick(describeScope("ChannelMessage.Read.All")), ["chat", "read", "Chat & meetings (read)", true]);
  assert.deepEqual(pick(describeScope("OnlineMeetings.ReadWrite")), ["chat", "write", "Chat & meetings (read/write)", true]);
});

test("sign-in identity scopes are never broad", () => {
  for (const scope of ["openid", "email", "profile", "offline_access", "User.Read", `${G}userinfo.email`]) {
    const desc = describeScope(scope);
    assert.equal(desc.category, "identity", scope);
    assert.equal(desc.broad, false, scope);
    assert.equal(desc.label, "Sign-in identity");
  }
});

test("drive.file is the narrow per-file grant, not broad Drive access", () => {
  const desc = describeScope(`${G}drive.file`);
  assert.equal(desc.category, "files");
  assert.equal(desc.broad, false);
  assert.match(desc.label, /opened with the app/);
});

test("unknown scopes are kept verbatim and not broad", () => {
  const desc = describeScope("https://example.com/auth/widgets");
  assert.equal(desc.category, "other");
  assert.equal(desc.broad, false);
  assert.equal(desc.label, "https://example.com/auth/widgets");
});

test("summary folds scopes per category, highest access wins, broad first", () => {
  const summary = summariseScopeAccess([
    "openid",
    `${G}calendar.readonly`,
    `${G}gmail.readonly`,
    "Mail.Send",
    `${G}gmail.readonly`, // duplicate
  ]);
  assert.deepEqual(
    summary.map((s) => [s.category, s.access, s.broad, s.scopes.length]),
    [
      ["mail", "write", true, 2],
      ["calendar", "read", true, 1],
      ["identity", "read", false, 1],
    ]
  );
});

test("described scopes are ordered broad-first, highest access first, identity last", () => {
  const ordered = describeScopes(["openid", `${G}drive.file`, "Mail.Read", "Files.ReadWrite.All", "https://mail.google.com/"]);
  assert.deepEqual(
    ordered.map((d) => d.scope),
    ["https://mail.google.com/", "Files.ReadWrite.All", "Mail.Read", `${G}drive.file`, "openid"]
  );
});

test("broadScopes and hasScopeAccess agree with the classifier", () => {
  const scopes = ["openid", `${G}drive.readonly`, "Mail.Read", `${G}drive.file`];
  assert.deepEqual(broadScopes(scopes), ["Mail.Read", `${G}drive.readonly`]);
  assert.equal(hasScopeAccess(scopes, "mail"), true);
  assert.equal(hasScopeAccess(scopes, "calendar"), false);
  assert.deepEqual(summariseScopeAccess(null), []);
});

function pick(desc: ReturnType<typeof describeScope>) {
  return [desc.category, desc.access, desc.label, desc.broad];
}
