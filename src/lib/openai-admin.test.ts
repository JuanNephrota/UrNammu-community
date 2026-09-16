import test from "node:test";
import assert from "node:assert/strict";
import { paginateOpenAI } from "./openai-admin";

test("paginateOpenAI follows next_page cursors until has_more is false", async () => {
  const seen: (string | undefined)[] = [];
  const result = await paginateOpenAI(async (page) => {
    seen.push(page);
    if (page === undefined) {
      return { object: "page", data: [{ start_time: 1 }, { start_time: 2 }], has_more: true, next_page: "page_2" };
    }
    if (page === "page_2") {
      return { object: "page", data: [{ start_time: 3 }], has_more: true, next_page: "page_3" };
    }
    return { object: "page", data: [{ start_time: 4 }], has_more: false, next_page: null };
  });

  assert.deepEqual(seen, [undefined, "page_2", "page_3"]);
  assert.equal(result.pages, 3);
  assert.equal(result.truncated, false);
  assert.deepEqual(
    result.data.map((bucket) => bucket.start_time),
    [1, 2, 3, 4],
  );
});

test("paginateOpenAI stops when has_more is true but next_page is missing", async () => {
  let calls = 0;
  const result = await paginateOpenAI(async () => {
    calls++;
    return { object: "page", data: [{ start_time: 1 }], has_more: true };
  });

  assert.equal(calls, 1);
  assert.equal(result.pages, 1);
  assert.equal(result.truncated, false);
});

test("paginateOpenAI records truncation when the page cap is reached with more pages available", async () => {
  let calls = 0;
  const result = await paginateOpenAI(
    async () => {
      calls++;
      return { object: "page", data: [{ start_time: calls }], has_more: true, next_page: `page_${calls + 1}` };
    },
    { maxPages: 3 },
  );

  assert.equal(calls, 3);
  assert.equal(result.pages, 3);
  assert.equal(result.truncated, true);
  assert.equal(result.data.length, 3);
});

test("paginateOpenAI tolerates a malformed envelope", async () => {
  const result = await paginateOpenAI(async () => ({ object: "page" }));
  assert.deepEqual(result, { data: [], pages: 1, truncated: false });
});
