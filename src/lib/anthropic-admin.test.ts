import test from "node:test";
import assert from "node:assert/strict";
import { paginateAnthropic } from "./anthropic-admin";

test("paginateAnthropic follows next_page cursors for report endpoints", async () => {
  const seen: (string | undefined)[] = [];
  const result = await paginateAnthropic(
    async (cursor) => {
      seen.push(cursor);
      if (cursor === undefined) {
        return { data: [{ starting_at: "2026-08-01" }], has_more: true, next_page: "p2" };
      }
      return { data: [{ starting_at: "2026-09-01" }], has_more: false, next_page: null };
    },
    { cursorField: "next_page" },
  );

  assert.deepEqual(seen, [undefined, "p2"]);
  assert.equal(result.pages, 2);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.data.map((b) => b.starting_at), ["2026-08-01", "2026-09-01"]);
});

test("paginateAnthropic follows last_id cursors for list endpoints", async () => {
  const seen: (string | undefined)[] = [];
  const result = await paginateAnthropic(
    async (cursor) => {
      seen.push(cursor);
      if (cursor === undefined) {
        return { data: [{ id: "k1" }, { id: "k2" }], has_more: true, last_id: "k2" };
      }
      return { data: [{ id: "k3" }], has_more: false, last_id: "k3" };
    },
    { cursorField: "last_id" },
  );

  assert.deepEqual(seen, [undefined, "k2"]);
  assert.equal(result.pages, 2);
  assert.deepEqual(result.data.map((k) => k.id), ["k1", "k2", "k3"]);
});

test("paginateAnthropic flags truncation when the page cap is hit with more available", async () => {
  let calls = 0;
  const result = await paginateAnthropic(
    async () => {
      calls++;
      return { data: [{ n: calls }], has_more: true, next_page: `p${calls + 1}` };
    },
    { maxPages: 3 },
  );

  assert.equal(calls, 3);
  assert.equal(result.pages, 3);
  assert.equal(result.truncated, true);
  assert.equal(result.data.length, 3);
});

test("paginateAnthropic stops cleanly when has_more is true but the cursor is missing", async () => {
  let calls = 0;
  const result = await paginateAnthropic(async () => {
    calls++;
    return { data: [{}], has_more: true, next_page: null };
  });
  assert.equal(calls, 1);
  assert.equal(result.truncated, false);
});
