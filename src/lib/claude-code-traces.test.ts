import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSessionTrace,
  buildTimeMapping,
  eventStatus,
  formatElapsed,
  IDLE_BUDGET,
  IDLE_GAP_MS,
  IDLE_RENDER_MS,
  MAX_EVENT_SPAN_MS,
  type ProxyCall,
  proxyStatus,
  requestIdOf,
  type TraceEventRow,
} from "./claude-code-traces";

const T0 = new Date("2026-09-10T12:00:00.000Z").getTime();

function ev(overrides: Partial<TraceEventRow> & { id: string }): TraceEventRow {
  return {
    timestamp: new Date(T0),
    userEmail: "dev@example.com",
    eventName: "api_request",
    toolName: null,
    decision: null,
    success: null,
    durationMs: null,
    model: null,
    statusCode: null,
    errorType: null,
    sessionId: "sess-1",
    entrypoint: "cli",
    riskSeverity: null,
    riskCategory: null,
    attributes: {},
    promptId: null,
    eventSequence: 0,
    ...overrides,
  };
}

test("returns null for a session with no events", () => {
  assert.equal(buildSessionTrace("sess-1", []), null);
});

test("treats timestamp as the span END, deriving start from durationMs", () => {
  // A 1000ms tool_result logged at T0+5000 must occupy [4000, 5000].
  const trace = buildSessionTrace("sess-1", [
    ev({ id: "a", eventName: "user_prompt", timestamp: new Date(T0 + 4000), eventSequence: 1 }),
    ev({
      id: "b",
      eventName: "tool_result",
      toolName: "Bash",
      durationMs: 1000,
      timestamp: new Date(T0 + 5000),
      eventSequence: 2,
    }),
  ]);
  assert.ok(trace);
  // Trace origin is the earliest start, which is the user_prompt at T0+4000.
  assert.equal(trace.totalMs, 1000);
  const [prompt, tool] = trace.root.children;
  assert.equal(prompt.startMs, 0);
  assert.equal(prompt.instant, true);
  assert.equal(tool.startMs, 0);
  assert.equal(tool.endMs, 1000);
  assert.equal(tool.instant, false);
});

test("groups events into turns by promptId and numbers them in sequence order", () => {
  const trace = buildSessionTrace("sess-1", [
    ev({ id: "p1", promptId: "prompt-A", eventName: "user_prompt", eventSequence: 1 }),
    ev({ id: "p2", promptId: "prompt-A", eventName: "api_request", eventSequence: 2 }),
    ev({ id: "p3", promptId: "prompt-B", eventName: "user_prompt", eventSequence: 3 }),
  ]);
  assert.ok(trace);
  assert.equal(trace.turnCount, 2);
  const turns = trace.root.children.filter((c) => c.kind === "turn");
  assert.deepEqual(
    turns.map((t) => t.name),
    ["Turn 1", "Turn 2"],
  );
  assert.equal(turns[0].children.length, 2);
  assert.equal(turns[1].children.length, 1);
});

test("hangs promptId-less lifecycle events off the session root, not a turn", () => {
  const trace = buildSessionTrace("sess-1", [
    ev({ id: "m1", eventName: "mcp_server_connection", durationMs: 500, timestamp: new Date(T0 + 500), eventSequence: 1 }),
    ev({ id: "p1", promptId: "prompt-A", eventName: "user_prompt", timestamp: new Date(T0 + 1000), eventSequence: 2 }),
  ]);
  assert.ok(trace);
  assert.equal(trace.turnCount, 1);
  assert.equal(trace.root.children.length, 2);
  assert.equal(trace.root.children[0].kind, "event");
  assert.equal(trace.root.children[0].eventName, "mcp_server_connection");
  assert.equal(trace.root.children[1].kind, "turn");
});

test("orders by eventSequence, not array order or timestamp ties", () => {
  // Same timestamp on every row: only eventSequence can disambiguate.
  const trace = buildSessionTrace("sess-1", [
    ev({ id: "third", eventName: "tool_result", eventSequence: 30 }),
    ev({ id: "first", eventName: "user_prompt", eventSequence: 10 }),
    ev({ id: "second", eventName: "api_request", eventSequence: 20 }),
  ]);
  assert.ok(trace);
  assert.deepEqual(
    trace.root.children.map((c) => c.id),
    ["first", "second", "third"],
  );
});

test("clamps implausible durations so one bad row cannot stretch the waterfall", () => {
  const bogus = MAX_EVENT_SPAN_MS + 60_000;
  const trace = buildSessionTrace("sess-1", [
    ev({ id: "a", durationMs: bogus, timestamp: new Date(T0 + bogus), eventSequence: 1 }),
  ]);
  assert.ok(trace);
  assert.equal(trace.totalMs, MAX_EVENT_SPAN_MS);
  assert.equal(trace.root.children[0].clamped, true);
  assert.equal(trace.root.clamped, true);
});

test("never produces a zero denominator for a single instant event", () => {
  const trace = buildSessionTrace("sess-1", [ev({ id: "a", eventSequence: 1 })]);
  assert.ok(trace);
  assert.equal(trace.totalMs, 1);
});

test("status precedence puts a risk verdict above an operational failure", () => {
  assert.equal(eventStatus(ev({ id: "a", eventName: "api_error" })), "error");
  assert.equal(eventStatus(ev({ id: "b", success: false, eventName: "tool_result" })), "error");
  assert.equal(eventStatus(ev({ id: "c", decision: "reject", eventName: "tool_decision" })), "denied");
  assert.equal(eventStatus(ev({ id: "d", eventName: "tool_result", success: true })), "ok");
  // A flagged prompt outranks a simultaneous failure — governance first.
  assert.equal(
    eventStatus(ev({ id: "e", eventName: "api_error", success: false, riskSeverity: "critical" })),
    "flagged",
  );
});

test("rolls the worst child status up to the turn and the session", () => {
  const trace = buildSessionTrace("sess-1", [
    ev({ id: "a", promptId: "p", eventName: "user_prompt", eventSequence: 1 }),
    ev({ id: "b", promptId: "p", eventName: "tool_result", success: true, eventSequence: 2 }),
    ev({ id: "c", promptId: "p", eventName: "api_error", eventSequence: 3 }),
  ]);
  assert.ok(trace);
  const turn = trace.root.children[0];
  assert.equal(turn.status, "error");
  assert.equal(trace.root.status, "error");
  assert.equal(trace.errorCount, 1);
  assert.match(turn.detail, /1 error/);
});

test("counts flagged events separately from errors", () => {
  const trace = buildSessionTrace("sess-1", [
    ev({ id: "a", promptId: "p", eventName: "user_prompt", riskSeverity: "critical", riskCategory: "exfiltration", eventSequence: 1 }),
    ev({ id: "b", promptId: "p", eventName: "api_error", eventSequence: 2 }),
  ]);
  assert.ok(trace);
  assert.equal(trace.flaggedCount, 1);
  assert.equal(trace.errorCount, 1);
  assert.equal(trace.root.status, "flagged");
});

test("carries identity from the first row that has it", () => {
  const trace = buildSessionTrace("sess-1", [
    ev({ id: "a", userEmail: null, entrypoint: null, eventSequence: 1 }),
    ev({ id: "b", userEmail: "dev@example.com", entrypoint: "local-agent", eventSequence: 2 }),
  ]);
  assert.ok(trace);
  assert.equal(trace.userEmail, "dev@example.com");
  assert.equal(trace.entrypoint, "local-agent");
});

// ─── Idle-gap compression ────────────────────────────────────────────────
// Sessions get resumed across days; without eliding dead air every real span
// renders as an invisible sliver.

test("merges overlapping spans into one active interval", () => {
  const { intervals, idleGaps, totalMs } = buildTimeMapping([
    { start: 0, end: 1000 },
    { start: 500, end: 1500 },
  ]);
  assert.equal(intervals.length, 1);
  assert.equal(idleGaps.length, 0);
  assert.equal(totalMs, 1500);
});

test("keeps short gaps at true scale", () => {
  // A 1s gap is under the threshold: it stays real, not elided.
  const { intervals, idleGaps, totalMs } = buildTimeMapping([
    { start: 0, end: 1000 },
    { start: 2000, end: 3000 },
  ]);
  assert.equal(intervals.length, 1);
  assert.equal(idleGaps.length, 0);
  assert.equal(totalMs, 3000);
});

test("elides a long idle gap to a budgeted display width", () => {
  const day = 24 * 60 * 60 * 1000;
  const { intervals, idleGaps, totalMs } = buildTimeMapping([
    { start: 0, end: 1000 },
    { start: day, end: day + 1000 },
  ]);
  assert.equal(intervals.length, 2);
  assert.equal(idleGaps.length, 1);
  assert.equal(idleGaps[0].atMs, 1000);
  assert.equal(idleGaps[0].durationMs, day - 1000);
  // 2000ms of active time, so the single gap gets IDLE_BUDGET of it.
  const expectedGap = 2000 * IDLE_BUDGET;
  assert.equal(idleGaps[0].renderMs, expectedGap);
  // Active time plus the elided gap — nothing like a whole day.
  assert.equal(totalMs, 1000 + expectedGap + 1000);
});

test("caps a single gap at IDLE_RENDER_MS however long the session", () => {
  const day = 24 * 60 * 60 * 1000;
  // 60s of active time: a quarter of it exceeds the flat cap, so the cap wins.
  const { idleGaps } = buildTimeMapping([
    { start: 0, end: 30_000 },
    { start: day, end: day + 30_000 },
  ]);
  assert.equal(idleGaps[0].renderMs, IDLE_RENDER_MS);
});

test("shares the elision budget so many gaps cannot swamp the timeline", () => {
  // 55 short turns separated by resume gaps — the real shape of a month-long
  // session. At a flat IDLE_RENDER_MS each, gaps took over half the width.
  const hour = 60 * 60 * 1000;
  const spans: { start: number; end: number }[] = [];
  let t = 0;
  for (let i = 0; i < 55; i++) {
    spans.push({ start: t, end: t + 2000 });
    t += 2000 + 5 * hour;
  }
  const { idleGaps, totalMs } = buildTimeMapping(spans);
  assert.equal(idleGaps.length, 54);
  const elided = idleGaps.reduce((sum, g) => sum + g.renderMs, 0);
  // Gaps stay within the budget, so the work keeps most of the width.
  assert.ok(
    elided / totalMs <= IDLE_BUDGET + 0.01,
    `gaps took ${((elided / totalMs) * 100).toFixed(1)}% of the timeline`,
  );
});

test("never returns a zero denominator", () => {
  assert.equal(buildTimeMapping([{ start: 5, end: 5 }]).totalMs, 1);
  assert.equal(buildTimeMapping([]).totalMs, 1);
});

test("a session resumed days later stays legible instead of collapsing", () => {
  const day = 24 * 60 * 60 * 1000;
  const trace = buildSessionTrace("sess-1", [
    // Day 1: one turn with a 2s tool call.
    ev({ id: "a", promptId: "p1", eventName: "user_prompt", timestamp: new Date(T0), eventSequence: 1 }),
    ev({
      id: "b", promptId: "p1", eventName: "tool_result", toolName: "Bash",
      durationMs: 2000, timestamp: new Date(T0 + 2000), eventSequence: 2,
    }),
    // Resumed three days later: another 2s tool call.
    ev({ id: "c", promptId: "p2", eventName: "user_prompt", timestamp: new Date(T0 + 3 * day), eventSequence: 3 }),
    ev({
      id: "d", promptId: "p2", eventName: "tool_result", toolName: "Bash",
      durationMs: 2000, timestamp: new Date(T0 + 3 * day + 2000), eventSequence: 4,
    }),
  ]);
  assert.ok(trace);

  // Wall-clock is three days; the plotted timeline is 4s of work plus the
  // elided gap. Without compression each 2s bar would be 0.0008% wide.
  assert.equal(trace.wallClockMs, 3 * day + 2000);
  const gapWidth = 4000 * IDLE_BUDGET;
  assert.equal(trace.totalMs, 2000 + gapWidth + 2000);
  assert.equal(trace.idleGaps.length, 1);

  const [turn1, turn2] = trace.root.children;
  // Each turn's 2s of work occupies a third of the timeline, not a sliver.
  assert.equal(turn1.endMs - turn1.startMs, 2000);
  assert.equal(turn2.endMs - turn2.startMs, 2000);
  assert.ok((turn1.endMs - turn1.startMs) / trace.totalMs > 0.3);
  // And turn 2 still comes after turn 1, with the gap between them.
  assert.ok(turn2.startMs >= turn1.endMs + gapWidth);
});

test("compression preserves parent/child containment", () => {
  const hour = 60 * 60 * 1000;
  const trace = buildSessionTrace("sess-1", [
    ev({ id: "a", promptId: "p1", eventName: "user_prompt", timestamp: new Date(T0), eventSequence: 1 }),
    ev({ id: "b", promptId: "p1", eventName: "api_request", durationMs: 500, timestamp: new Date(T0 + 500), eventSequence: 2 }),
    ev({ id: "c", promptId: "p2", eventName: "user_prompt", timestamp: new Date(T0 + hour), eventSequence: 3 }),
    ev({ id: "d", promptId: "p2", eventName: "api_request", durationMs: 500, timestamp: new Date(T0 + hour + 500), eventSequence: 4 }),
  ]);
  assert.ok(trace);
  for (const turn of trace.root.children) {
    for (const child of turn.children) {
      assert.ok(child.startMs >= turn.startMs, `${child.id} starts before its turn`);
      assert.ok(child.endMs <= turn.endMs, `${child.id} ends after its turn`);
    }
    assert.ok(turn.endMs <= trace.totalMs, "turn overflows the timeline");
  }
});

test("gap threshold is the boundary, not an approximation", () => {
  // Exactly at the threshold: still one interval (merge is <=).
  const atThreshold = buildTimeMapping([
    { start: 0, end: 0 },
    { start: IDLE_GAP_MS, end: IDLE_GAP_MS },
  ]);
  assert.equal(atThreshold.idleGaps.length, 0);
  // One millisecond past it: elided.
  const past = buildTimeMapping([
    { start: 0, end: 0 },
    { start: IDLE_GAP_MS + 1, end: IDLE_GAP_MS + 1 },
  ]);
  assert.equal(past.idleGaps.length, 1);
});

// ─── Ordering across session resumes ─────────────────────────────────────

test("orders chronologically when eventSequence restarts on resume", () => {
  const day = 24 * 60 * 60 * 1000;
  // eventSequence is a per-process counter: a resumed session restarts it, so
  // day 2's events carry LOWER sequence numbers than day 1's. Sorting by
  // sequence would interleave two different days.
  const trace = buildSessionTrace("sess-1", [
    ev({ id: "day1-a", eventName: "user_prompt", promptId: "p1", timestamp: new Date(T0), eventSequence: 40 }),
    ev({ id: "day1-b", eventName: "api_request", promptId: "p1", timestamp: new Date(T0 + 1000), eventSequence: 41 }),
    ev({ id: "day2-a", eventName: "user_prompt", promptId: "p2", timestamp: new Date(T0 + day), eventSequence: 1 }),
    ev({ id: "day2-b", eventName: "api_request", promptId: "p2", timestamp: new Date(T0 + day + 1000), eventSequence: 2 }),
  ]);
  assert.ok(trace);
  const turns = trace.root.children;
  assert.equal(turns.length, 2);
  // Day 1 must come first despite carrying the higher sequence numbers.
  assert.deepEqual(
    turns[0].children.map((c) => c.id),
    ["day1-a", "day1-b"],
  );
  assert.deepEqual(
    turns[1].children.map((c) => c.id),
    ["day2-a", "day2-b"],
  );
  assert.ok(turns[1].startMs > turns[0].startMs);
});

test("still uses eventSequence to break same-millisecond ties", () => {
  const trace = buildSessionTrace("sess-1", [
    ev({ id: "second", eventName: "assistant_response", timestamp: new Date(T0), eventSequence: 20 }),
    ev({ id: "first", eventName: "api_request", timestamp: new Date(T0), eventSequence: 10 }),
  ]);
  assert.ok(trace);
  assert.deepEqual(
    trace.root.children.map((c) => c.id),
    ["first", "second"],
  );
});

// ─── Bar pinning ─────────────────────────────────────────────────────────

test("pins span starts non-decreasing so the trace cannot render backwards", () => {
  // The second event reports a 60s window that reaches back before the first
  // event began — taken literally its bar would start to the left of it.
  const trace = buildSessionTrace("sess-1", [
    ev({ id: "a", eventName: "user_prompt", timestamp: new Date(T0 + 10_000), eventSequence: 1 }),
    ev({ id: "b", eventName: "api_request", durationMs: 60_000, timestamp: new Date(T0 + 11_000), eventSequence: 2 }),
  ]);
  assert.ok(trace);
  const [a, b] = trace.root.children;
  assert.ok(b.startMs >= a.startMs, "bar starts must not go backwards");
  assert.equal(b.clipped, true);
  assert.equal(a.clipped, false);
});

test("a pinned bar keeps the duration the event reported", () => {
  const trace = buildSessionTrace("sess-1", [
    ev({ id: "a", eventName: "user_prompt", timestamp: new Date(T0 + 10_000), eventSequence: 1 }),
    ev({ id: "b", eventName: "api_request", durationMs: 60_000, timestamp: new Date(T0 + 11_000), eventSequence: 2 }),
  ]);
  assert.ok(trace);
  const b = trace.root.children[1];
  // Geometry was compressed, but the reported number survives for the readout.
  assert.equal(b.reportedMs, 60_000);
  assert.ok(b.endMs - b.startMs < 60_000);
});

test("leaves honest concurrency alone — only starts are pinned, ends overlap", () => {
  // Two tools dispatched in order, finishing out of order: the overlap is real
  // and must survive.
  const trace = buildSessionTrace("sess-1", [
    ev({ id: "slow", eventName: "tool_result", toolName: "WebSearch", durationMs: 5000, timestamp: new Date(T0 + 6000), eventSequence: 1 }),
    ev({ id: "fast", eventName: "tool_result", toolName: "WebFetch", durationMs: 500, timestamp: new Date(T0 + 2000), eventSequence: 2 }),
  ]);
  assert.ok(trace);
  // Chronological order puts the fast one first (it ended at +2s).
  const [first, second] = trace.root.children;
  assert.equal(first.id, "fast");
  assert.equal(second.id, "slow");
  // Their spans still overlap: neither was collapsed to a point.
  assert.ok(second.startMs < first.endMs, "concurrent spans should overlap");
  assert.equal(second.reportedMs, 5000);
});

// ─── Elapsed formatting ──────────────────────────────────────────────────

test("formatElapsed carries its rounding instead of emitting 2d 24h", () => {
  const sec = 1000, min = 60 * sec, hour = 60 * min, day = 24 * hour;
  // The case seen on a real trace: a hair under three days.
  assert.equal(formatElapsed(3 * day - 2100), "3d");
  // And a hair under two hours, which used to read "1h 60m".
  assert.equal(formatElapsed(2 * hour - 100), "2h");
  // Exactly an hour of minutes should promote to hours, not read "60m".
  assert.equal(formatElapsed(60 * min), "1h");
});

test("formatElapsed picks a sensible unit at each scale", () => {
  const sec = 1000, min = 60 * sec, hour = 60 * min, day = 24 * hour;
  assert.equal(formatElapsed(0), "0ms");
  assert.equal(formatElapsed(450), "450ms");
  assert.equal(formatElapsed(2.5 * sec), "2.5s");
  assert.equal(formatElapsed(5 * min), "5m");
  assert.equal(formatElapsed(hour + 30 * min), "1h 30m");
  assert.equal(formatElapsed(3 * day + 5 * hour), "3d 5h");
});

// ─── Joining the proxy's view of a model call ────────────────────────────

function proxyCall(overrides: Partial<ProxyCall> = {}): ProxyCall {
  return {
    id: "log-1",
    requestId: "req_abc",
    model: "claude-opus-5",
    totalTokens: 2481,
    cost: 0.0043,
    flagged: false,
    flagCategory: null,
    flagReason: null,
    latencyMs: 800,
    ...overrides,
  };
}

/** An api_request that reports the provider request id, as Claude Code does. */
function apiRequest(id: string, at: number, durationMs: number, requestId?: string) {
  return ev({
    id,
    eventName: "api_request",
    promptId: "p1",
    timestamp: new Date(at),
    durationMs,
    eventSequence: 1,
    attributes: requestId ? { request_id: requestId } : {},
  });
}

test("requestIdOf reads the provider request id, or null when absent", () => {
  assert.equal(requestIdOf(apiRequest("a", T0, 1000, "req_abc")), "req_abc");
  assert.equal(requestIdOf(apiRequest("a", T0, 1000)), null);
  assert.equal(
    requestIdOf(ev({ id: "a", attributes: { request_id: "" } })),
    null,
    "an empty id is not a usable join key",
  );
});

test("attaches the proxy's row under the model call it describes", () => {
  const trace = buildSessionTrace(
    "sess-1",
    [apiRequest("a", T0 + 5000, 1000, "req_abc")],
    [proxyCall()],
  );
  assert.ok(trace);
  const call = trace.root.children[0].children[0];
  assert.equal(call.id, "a");
  assert.equal(call.children.length, 1);
  assert.equal(call.children[0].kind, "proxy");
  assert.equal(trace.proxyCallCount, 1);
});

test("leaves a model call alone when no proxy row matches it", () => {
  // The overwhelmingly common case today: the call never went via the proxy.
  const trace = buildSessionTrace(
    "sess-1",
    [apiRequest("a", T0 + 5000, 1000, "req_zzz")],
    [proxyCall({ requestId: "req_abc" })],
  );
  assert.ok(trace);
  assert.equal(trace.root.children[0].children[0].children.length, 0);
  assert.equal(trace.proxyCallCount, 0);
});

test("an event with no request id never matches a proxy row", () => {
  const trace = buildSessionTrace(
    "sess-1",
    [apiRequest("a", T0 + 5000, 1000)],
    [proxyCall()],
  );
  assert.ok(trace);
  assert.equal(trace.root.children[0].children[0].children.length, 0);
});

test("sizes the proxy bar by measured upstream latency, ending with its parent", () => {
  // Client saw 1000ms; the proxy measured 800ms upstream. The 200ms gap is
  // client-side overhead the provider never saw, and should be visible.
  const trace = buildSessionTrace(
    "sess-1",
    [apiRequest("a", T0 + 5000, 1000, "req_abc")],
    [proxyCall({ latencyMs: 800 })],
  );
  assert.ok(trace);
  const parent = trace.root.children[0].children[0];
  const proxy = parent.children[0];
  assert.equal(proxy.endMs, parent.endMs, "both end when the response completes");
  assert.equal(proxy.startMs - parent.startMs, 200);
  assert.equal(proxy.reportedMs, 800);
});

test("clamps a proxy bar that claims more time than its parent", () => {
  // The two clocks are independent, so the proxy can report a longer window.
  // Containment must hold regardless.
  const trace = buildSessionTrace(
    "sess-1",
    [apiRequest("a", T0 + 5000, 1000, "req_abc")],
    [proxyCall({ latencyMs: 9000 })],
  );
  assert.ok(trace);
  const parent = trace.root.children[0].children[0];
  const proxy = parent.children[0];
  assert.ok(proxy.startMs >= parent.startMs);
  assert.ok(proxy.endMs <= parent.endMs);
});

test("maps the proxy's verdict onto the trace's status vocabulary", () => {
  assert.equal(proxyStatus(proxyCall({ flagCategory: "prompt_risk", flagged: true })), "denied");
  assert.equal(proxyStatus(proxyCall({ flagCategory: "sensitive_response", flagged: true })), "flagged");
  assert.equal(proxyStatus(proxyCall({ flagCategory: "upstream_error", flagged: true })), "error");
  assert.equal(proxyStatus(proxyCall({ flagCategory: "proxy_error", flagged: true })), "error");
  assert.equal(proxyStatus(proxyCall()), "ok");
});

test("a proxy block raises the model call's own status", () => {
  // Claude Code reports a clean api_request — it never learns the proxy
  // refused the prompt. The trace must not look clean.
  const trace = buildSessionTrace(
    "sess-1",
    [apiRequest("a", T0 + 5000, 1000, "req_abc")],
    [proxyCall({ flagged: true, flagCategory: "prompt_risk", flagReason: "secret in prompt" })],
  );
  assert.ok(trace);
  const parent = trace.root.children[0].children[0];
  assert.equal(parent.status, "denied");
  assert.equal(trace.root.children[0].status, "denied", "and rolls up to the turn");
  assert.match(parent.children[0].detail, /secret in prompt/);
});

test("a proxy-only verdict is counted in the header, not just the rows", () => {
  // Claude Code saw a clean call, so counting raw events would report zero
  // errors while the trace itself renders DENIED.
  const trace = buildSessionTrace(
    "sess-1",
    [apiRequest("a", T0 + 5000, 1000, "req_abc")],
    [proxyCall({ flagged: true, flagCategory: "prompt_risk", flagReason: "secret in prompt" })],
  );
  assert.ok(trace);
  assert.equal(trace.errorCount, 1);
});

test("a proxy latency under a second reads in ms, not 0.0s", () => {
  const trace = buildSessionTrace(
    "sess-1",
    [apiRequest("a", T0 + 5000, 1000, "req_abc")],
    [proxyCall({ latencyMs: 40 })],
  );
  assert.ok(trace);
  const proxy = trace.root.children[0].children[0].children[0];
  assert.match(proxy.detail, /40ms upstream/);
});
