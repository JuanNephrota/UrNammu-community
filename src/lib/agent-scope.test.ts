import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyTool,
  evaluateAgentScope,
  findClassificationRule,
  heuristicToolAccess,
  isOnOwnAllowlist,
  maxToolAccessFor,
  normalizeAccessLevel,
  scopeVerdictFor,
  type AgentScopeConfig,
  type ToolClassificationRule,
} from "./agent-scope";
import {
  SCOPE_RULE,
  humanReviewBlockedBody,
  humanReviewDenialReasons,
  isScopeMatch,
  normalizeHumanReviewTriggers,
  summarizeMatches,
} from "./human-review-triggers";
import type { ObservedToolUse } from "./mcp-tool-governance";

const use = (toolName: string, serverName: string | null = "jira"): ObservedToolUse => ({
  kind: serverName ? "mcp_tool_use" : "tool_use",
  serverName,
  toolName,
});

const scope = (over: Partial<AgentScopeConfig> = {}): AgentScopeConfig => ({
  accessLevel: "read-only",
  connectedSystems: [],
  enforcement: "monitor",
  toolAllowlist: [],
  rules: [],
  ...over,
});

// ── heuristics ───────────────────────────────────────────────────────

test("name heuristic: destructive > mutating > reading, camelCase and dashes tokenised", () => {
  assert.equal(heuristicToolAccess("get_issue"), "read");
  assert.equal(heuristicToolAccess("searchIssues"), "read");
  assert.equal(heuristicToolAccess("list-users"), "read");
  assert.equal(heuristicToolAccess("create_issue"), "write");
  assert.equal(heuristicToolAccess("get_order"), "read");
  assert.equal(heuristicToolAccess("bulk_create_issues"), "write");
  assert.equal(heuristicToolAccess("delete_issue"), "admin");
  assert.equal(heuristicToolAccess("force_delete"), "admin");
  assert.equal(heuristicToolAccess("grantRole"), "admin");
  assert.equal(heuristicToolAccess("web_search"), "read");
  assert.equal(heuristicToolAccess("code_execution"), "write");
  assert.equal(heuristicToolAccess("frobnicate"), null);
  assert.equal(heuristicToolAccess(""), null);
});

test("classifyTool: rule beats heuristic beats the write default", () => {
  const rules: ToolClassificationRule[] = [{ server: "jira", tool: "delete_issue", access: "write", system: "Jira" }];
  assert.deepEqual(classifyTool(use("delete_issue"), rules), { access: "write", system: "Jira", source: "rule", rule: rules[0] });
  assert.deepEqual(classifyTool(use("get_issue"), rules), { access: "read", system: null, source: "heuristic" });
  assert.deepEqual(classifyTool(use("frobnicate"), rules), { access: "write", system: null, source: "default" });
});

test("most specific rule wins; `*` any server, `-` only serverless tools", () => {
  const rules: ToolClassificationRule[] = [
    { server: "*", tool: "*", access: "read" },
    { server: "*", tool: "run_*", access: "write" },
    { server: "jira", tool: "*", access: "write" },
    { server: "jira", tool: "run_report", access: "read" },
    { server: "-", tool: "bash", access: "admin" },
  ];
  assert.equal(findClassificationRule(use("run_report"), rules)?.access, "read");
  assert.equal(findClassificationRule(use("run_export"), rules)?.access, "write");
  assert.equal(findClassificationRule(use("get_issue"), rules)?.access, "write");
  assert.equal(findClassificationRule(use("get_issue", "github"), rules)?.access, "read");
  assert.equal(findClassificationRule(use("bash", null), rules)?.access, "admin");
  assert.equal(findClassificationRule(use("bash", "shell-server"), rules)?.access, "read");
});

// ── evaluation ───────────────────────────────────────────────────────

test("read-only agent: read tools in scope, write and admin tools out", () => {
  const matches = evaluateAgentScope(scope(), [use("get_issue"), use("create_issue"), use("delete_issue")]);
  assert.deepEqual(
    matches.map((m) => [m.tool, (m.trigger as { rule: string }).rule]),
    [
      ["jira/create_issue", "access_level"],
      ["jira/delete_issue", "access_level"],
    ]
  );
  assert.ok(matches.every(isScopeMatch));
  assert.match(matches[0].detail, /write tool \(by name write\) exceeds access level read-only/);
});

test("read-write allows write but not admin; admin allows everything", () => {
  const uses = [use("get_issue"), use("create_issue"), use("delete_issue")];
  assert.deepEqual(
    evaluateAgentScope(scope({ accessLevel: "read-write" }), uses).map((m) => m.tool),
    ["jira/delete_issue"]
  );
  assert.deepEqual(evaluateAgentScope(scope({ accessLevel: "admin" }), uses), []);
});

test("unclassified tool is treated as write, so a read-only agent cannot call it", () => {
  const [m] = evaluateAgentScope(scope(), [use("frobnicate")]);
  assert.match(m.detail, /unclassified, treated as write/);
  assert.deepEqual(evaluateAgentScope(scope({ rules: [{ server: "jira", tool: "frobnicate", access: "read" }] }), [use("frobnicate")]), []);
});

test("restricted agent: only its own allowlisted read tools", () => {
  const s = scope({ accessLevel: "restricted", toolAllowlist: ["jira/get_issue", "jira/create_issue"] });
  const matches = evaluateAgentScope(s, [use("get_issue"), use("create_issue"), use("search_issues")]);
  assert.deepEqual(
    matches.map((m) => [m.tool, (m.trigger as { rule: string }).rule]),
    [
      ["jira/create_issue", "access_level"],
      ["jira/search_issues", "restricted"],
    ]
  );
  assert.equal(isOnOwnAllowlist(["*"], use("x")), false, "a bare * does not count as an explicit entry");
});

test("connected systems: enforced only when documented, against the rule's system", () => {
  const rules: ToolClassificationRule[] = [
    { server: "zapier", tool: "sf_*", access: "read", system: "Salesforce" },
    { server: "jira", tool: "*", access: "read", system: "Jira" },
  ];
  const uses = [use("sf_query", "zapier"), use("get_issue")];
  assert.deepEqual(evaluateAgentScope(scope({ rules }), uses), [], "undocumented connected systems are not enforced");
  const matches = evaluateAgentScope(scope({ rules, connectedSystems: [" jira ", "Zapier"] }), uses);
  assert.deepEqual(matches.map((m) => [m.tool, (m.trigger as { rule: string }).rule]), [["zapier/sf_query", "connected_system"]]);
  assert.match(matches[0].detail, /"Salesforce"/);
});

test("one call can violate both access level and connected system", () => {
  const rules: ToolClassificationRule[] = [{ server: "zapier", tool: "sf_update", access: "write", system: "Salesforce" }];
  const matches = evaluateAgentScope(scope({ rules, connectedSystems: ["Jira"] }), [use("sf_update", "zapier")]);
  assert.deepEqual(matches.map((m) => (m.trigger as { rule: string }).rule), ["access_level", "connected_system"]);
});

test("scopeVerdictFor and level helpers", () => {
  const v = scopeVerdictFor(scope(), { serverName: "jira", toolName: "create_issue" });
  assert.equal(v.classification.access, "write");
  assert.equal(v.violations.length, 1);
  assert.equal(maxToolAccessFor("restricted"), "read");
  assert.equal(maxToolAccessFor("read-write"), "write");
  assert.equal(normalizeAccessLevel("bogus"), "read-only");
  assert.equal(normalizeAccessLevel("admin"), "admin");
});

// ── plumbing into denials / 403 bodies ───────────────────────────────

test("scope matches get their own rule key in denial reasons, summaries and the 403 body", () => {
  const agent = { id: "a1", name: "Triage bot" };
  const matches = evaluateAgentScope(scope(), [use("create_issue")]);
  const [reason] = humanReviewDenialReasons(agent, matches);
  assert.equal(reason.ruleKey, SCOPE_RULE);
  assert.equal(reason.policyName, "Agent charter scope: Triage bot");
  assert.equal(summarizeMatches(matches)[0].rule, SCOPE_RULE);
  const body = humanReviewBlockedBody(agent, matches);
  assert.equal(body.error.type, SCOPE_RULE);
  assert.match(body.error.message, /not waivable/);
  assert.equal(body.error.violations[0].rule, SCOPE_RULE);
  assert.equal("review" in body.error, false);
});

test("mixed matches keep the human_review_required type and mention the scope violations", () => {
  const agent = { id: "a1", name: "Triage bot" };
  const scopeMatches = evaluateAgentScope(scope(), [use("create_issue")]);
  const review = { ...scopeMatches[0], trigger: { kind: "tool" as const, tool: "jira/*" }, triggerLabel: "any call to jira/*" };
  const body = humanReviewBlockedBody(agent, [review, ...scopeMatches], { id: "r1", url: null });
  assert.equal(body.error.type, "human_review_required");
  assert.match(body.error.message, /1 call is also outside the agent's charter scope/);
  assert.deepEqual(body.error.violations.map((v) => v.rule), ["human_review_required", SCOPE_RULE]);
});

test("a stored `scope` trigger is dropped by normalisation", () => {
  assert.deepEqual(normalizeHumanReviewTriggers([{ kind: "scope", rule: "access_level" }, { kind: "tool", tool: "x" }]), [
    { kind: "tool", tool: "x" },
  ]);
});
