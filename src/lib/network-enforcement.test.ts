import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { proxyEnforcementOutcome } from "./network-enforcement";

const tool = { toolName: "Jasper", detectedDomain: "https://app.Jasper.ai/login" };

describe("proxyEnforcementOutcome", () => {
  it("is enforced only in enforce mode", () => {
    const r = proxyEnforcementOutcome(tool, "enforce", true);
    assert.equal(r.enforced, true);
    assert.equal(r.action, "blocked");
    assert.equal(r.domain, "app.jasper.ai");
    assert.match(r.message, /403/);
  });

  it("reports monitor and off modes as not enforced, with guidance", () => {
    const m = proxyEnforcementOutcome(tool, "monitor", true);
    assert.equal(m.enforced, false);
    assert.equal(m.action, "monitored");
    assert.match(m.message, /Monitor mode/);
    const o = proxyEnforcementOutcome(tool, "off", true);
    assert.equal(o.action, "off");
    assert.match(o.message, /Settings → Proxy Setup/);
  });

  it("skips tools without a domain", () => {
    const r = proxyEnforcementOutcome({ toolName: "Mystery", detectedDomain: null }, "enforce", true);
    assert.equal(r.action, "skipped");
    assert.equal(r.domain, null);
  });

  it("describes an unblock", () => {
    const r = proxyEnforcementOutcome(tool, "enforce", false);
    assert.equal(r.action, "unblocked");
    assert.equal(r.enforced, true);
    assert.match(r.message, /no longer denied/);
  });
});
