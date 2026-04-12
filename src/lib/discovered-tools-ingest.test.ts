import test from "node:test";
import assert from "node:assert/strict";
import { parseEntriesFromCsv } from "./discovered-tools-ingest";

test("parseEntriesFromCsv uses generic headers for dns proxy imports", () => {
  const entries = parseEntriesFromCsv(
    "domain,user,department,count\nchat.openai.com,alice@example.com,Legal,4\nclaude.ai,bob@example.com,Security,2",
    "dns_proxy"
  );

  assert.deepEqual(entries, [
    {
      domain: "chat.openai.com",
      user: "alice@example.com",
      department: "Legal",
      count: 4,
    },
    {
      domain: "claude.ai",
      user: "bob@example.com",
      department: "Security",
      count: 2,
    },
  ]);
});

test("parseEntriesFromCsv maps Cisco Umbrella-style identity and query fields", () => {
  const entries = parseEntriesFromCsv(
    "Query Name,Most Granular Identity,Group,Count\nchat.openai.com,jane@example.com,Finance,8",
    "umbrella"
  );

  assert.deepEqual(entries, [
    {
      domain: "chat.openai.com",
      user: "jane@example.com",
      department: "Finance",
      count: 8,
    },
  ]);
});

test("parseEntriesFromCsv maps Cloudflare Gateway host and email fields", () => {
  const entries = parseEntriesFromCsv(
    "Host,Email,Team,Requests\nclaude.ai,ops@example.com,Platform,12",
    "cloudflare_gateway"
  );

  assert.deepEqual(entries, [
    {
      domain: "claude.ai",
      user: "ops@example.com",
      department: "Platform",
      count: 12,
    },
  ]);
});

test("parseEntriesFromCsv falls back to actor identifiers when user columns are absent", () => {
  const entries = parseEntriesFromCsv(
    "Domain,Device Name,Count\nchat.openai.com,HOST-17,3",
    "other"
  );

  assert.deepEqual(entries, [
    {
      domain: "chat.openai.com",
      user: "HOST-17",
      department: undefined,
      count: 3,
    },
  ]);
});
