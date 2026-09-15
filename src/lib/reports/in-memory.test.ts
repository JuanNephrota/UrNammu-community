import test from "node:test";
import assert from "node:assert/strict";
import { filterRows, groupRows, sortRows } from "./in-memory";
import type { SourceColumn } from "./data-sources";

const columns: SourceColumn[] = [
  { key: "email", label: "Email", type: "string", field: "email" },
  { key: "department", label: "Department", type: "string", field: "department" },
  { key: "totalCost", label: "Total Cost", type: "currency", field: "totalCost", aggregate: "sum" },
  { key: "sessions", label: "Sessions", type: "number", field: "sessions", aggregate: "avg" },
  { key: "lastActiveAt", label: "Last Active", type: "date", field: "lastActiveAt" },
];
const col = (key: string) => columns.find((c) => c.key === key);

const rows = [
  { email: "a@x.io", department: "Eng", totalCost: 12.5, sessions: 4, lastActiveAt: "2026-09-14T00:00:00.000Z" },
  { email: "b@x.io", department: "Eng", totalCost: 3, sessions: 2, lastActiveAt: "2026-09-01T00:00:00.000Z" },
  { email: "c@x.io", department: null, totalCost: 7, sessions: null, lastActiveAt: null },
];

test("filters apply typed comparisons and text contains", () => {
  assert.deepEqual(
    filterRows(rows, [{ field: "totalCost", operator: "gte", value: "7" }], col).map((r) => r.email),
    ["a@x.io", "c@x.io"],
  );
  assert.deepEqual(
    filterRows(rows, [{ field: "email", operator: "contains", value: "B@" }], col).map((r) => r.email),
    ["b@x.io"],
  );
  assert.deepEqual(
    filterRows(rows, [{ field: "department", operator: "in", value: ["Eng"] }], col).map((r) => r.email),
    ["a@x.io", "b@x.io"],
  );
  assert.deepEqual(
    filterRows(rows, [{ field: "lastActiveAt", operator: "gt", value: "2026-09-10" }], col).map((r) => r.email),
    ["a@x.io"],
  );
  // unknown field is ignored rather than filtering everything out
  assert.equal(filterRows(rows, [{ field: "nope", operator: "eq", value: "x" }], col).length, 3);
});

test("sorting is typed and keeps nulls last in both directions", () => {
  assert.deepEqual(
    sortRows(rows, { field: "totalCost", direction: "desc" }, col("totalCost")).map((r) => r.email),
    ["a@x.io", "c@x.io", "b@x.io"],
  );
  assert.deepEqual(
    sortRows(rows, { field: "sessions", direction: "asc" }, col("sessions")).map((r) => r.email),
    ["b@x.io", "a@x.io", "c@x.io"],
  );
  assert.deepEqual(
    sortRows(rows, { field: "lastActiveAt", direction: "desc" }, col("lastActiveAt")).map((r) => r.email),
    ["a@x.io", "b@x.io", "c@x.io"],
  );
});

test("grouping counts rows and sums or averages numeric columns", () => {
  const { columns: out, rows: grouped } = groupRows(rows, col("department")!, [col("totalCost")!, col("sessions")!]);
  assert.deepEqual(out.map((c) => c.key), ["department", "_count", "agg_totalCost", "agg_sessions"]);
  assert.equal(out[2].label, "Total Total Cost");
  assert.equal(out[3].label, "Avg Sessions");
  const eng = grouped.find((g) => g.department === "Eng")!;
  assert.equal(eng._count, 2);
  assert.equal(eng.agg_totalCost, 15.5);
  assert.equal(eng.agg_sessions, 3);
  const none = grouped.find((g) => g.department === null)!;
  assert.equal(none._count, 1);
  assert.equal(none.agg_sessions, 0);
});
