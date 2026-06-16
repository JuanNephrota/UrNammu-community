import test from "node:test";
import assert from "node:assert/strict";
import { datadogEventsUrl, resolveDatadogSite } from "./datadog-client";

test("resolveDatadogSite falls back to datadoghq.com for unknown values", () => {
  assert.equal(resolveDatadogSite(null), "datadoghq.com");
  assert.equal(resolveDatadogSite(undefined), "datadoghq.com");
  assert.equal(resolveDatadogSite(""), "datadoghq.com");
  assert.equal(resolveDatadogSite("bogus.datadog.com"), "datadoghq.com");
});

test("resolveDatadogSite returns the exact site when supported", () => {
  assert.equal(resolveDatadogSite("datadoghq.com"), "datadoghq.com");
  assert.equal(resolveDatadogSite("datadoghq.eu"), "datadoghq.eu");
  assert.equal(resolveDatadogSite("us3.datadoghq.com"), "us3.datadoghq.com");
  assert.equal(resolveDatadogSite("us5.datadoghq.com"), "us5.datadoghq.com");
  assert.equal(resolveDatadogSite("ap1.datadoghq.com"), "ap1.datadoghq.com");
  assert.equal(resolveDatadogSite("ddog-gov.com"), "ddog-gov.com");
});

test("datadogEventsUrl builds the per-site events endpoint", () => {
  assert.equal(datadogEventsUrl("datadoghq.com"), "https://api.datadoghq.com/api/v1/events");
  assert.equal(datadogEventsUrl("datadoghq.eu"), "https://api.datadoghq.eu/api/v1/events");
  assert.equal(datadogEventsUrl("us3.datadoghq.com"), "https://api.us3.datadoghq.com/api/v1/events");
  assert.equal(datadogEventsUrl("ddog-gov.com"), "https://api.ddog-gov.com/api/v1/events");
});
