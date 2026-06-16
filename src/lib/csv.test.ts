import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "./csv";

test("parseCsv handles quoted commas and escaped quotes", () => {
  const rows = parseCsv('domain,user,count\n"chat.openai.com","Doe, Jane",4\n"claude.ai","""Ops"" Team",2');

  assert.deepEqual(rows, [
    ["domain", "user", "count"],
    ["chat.openai.com", "Doe, Jane", "4"],
    ["claude.ai", '"Ops" Team', "2"],
  ]);
});

test("parseCsv supports plain one-column text", () => {
  const rows = parseCsv("chat.openai.com\nclaude.ai\n");
  assert.deepEqual(rows, [["chat.openai.com"], ["claude.ai"]]);
});
