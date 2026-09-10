import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { enforceIdentityBlock } from "./identity-enforcement";

/**
 * Covers the deterministic branches that don't reach an identity provider.
 * The Microsoft path (config + Graph PATCH) is exercised via integration, not
 * here, to keep this unit test free of network/DB dependencies.
 */
describe("enforceIdentityBlock", () => {
  it("skips tools with no captured app handle", async () => {
    const r = await enforceIdentityBlock(
      { toolName: "Jasper", externalAppId: null, externalAppProvider: null },
      true
    );
    assert.equal(r.enforced, false);
    assert.equal(r.action, "skipped");
    assert.match(r.message, /network blocklist feed/i);
  });

  it("skips when a provider is set but the app id is missing", async () => {
    const r = await enforceIdentityBlock(
      { toolName: "Jasper", externalAppId: null, externalAppProvider: "microsoft_365" },
      true
    );
    assert.equal(r.action, "skipped");
  });

  it("reports Google unblock as not programmatically restorable", async () => {
    // The block=true path performs live token revocation (config + Directory
    // API), so it's covered by integration, not here. The unblock path is
    // deterministic: Google access can't be restored via API.
    const r = await enforceIdentityBlock(
      {
        toolName: "Otter.ai",
        externalAppId: "123.apps.googleusercontent.com",
        externalAppProvider: "google_workspace",
      },
      false
    );
    assert.equal(r.enforced, false);
    assert.equal(r.action, "unsupported");
    assert.equal(r.provider, "google_workspace");
    assert.match(r.message, /re-authorize/i);
  });

  it("reports an unknown provider as unsupported", async () => {
    const r = await enforceIdentityBlock(
      { toolName: "Mystery", externalAppId: "abc", externalAppProvider: "okta" },
      true
    );
    assert.equal(r.action, "unsupported");
  });
});
