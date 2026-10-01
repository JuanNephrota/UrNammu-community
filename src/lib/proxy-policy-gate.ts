/**
 * Runtime policy-as-code gate for the Vercel proxy paths.
 *
 * Mirrors the Azure Functions proxy's `policy-loader.ts` + `policy-enforcement.ts`
 * (kept in sync by convention — the shape of `PolicyRuntimeRules` is shared
 * through `policy-rules.ts`). The global `policy_enforcement_mode` setting
 * drives behaviour: `off` skips evaluation, `dryrun` records denials but
 * forwards, `enforce` returns 403 on blocking violations. Every provider
 * handler feeds the same canonical request body (see `policyViewOf` in
 * proxy-providers.ts) so one rule set governs Anthropic, OpenAI, Azure
 * OpenAI, Gemini and Bedrock traffic alike.
 */
import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { getSetting, parseEnforcementMode, type PolicyEnforcementMode } from "./settings";
import { parsePolicyRules, type PolicyRuntimeRules } from "./policy-rules";
import { sanitizeText } from "./prompt-risk";
import { isSafeRuntimePattern, MAX_PROMPT_SCAN_CHARS } from "./regex-safety";

export type LoadedPolicy = {
  policyId: string;
  policyName: string;
  enforcement: "BLOCK" | "ADVISORY";
  runtime: PolicyRuntimeRules;
};

export type Violation = {
  ruleKey: string;
  message: string;
  policyId: string;
  policyName: string;
};

type CacheEntry<T> = { value: T; expiresAt: number };

const MODE_TTL_MS = 30_000;
const POLICIES_TTL_MS = 30_000;

let modeCache: CacheEntry<PolicyEnforcementMode> | null = null;
const policiesCache = new Map<string, CacheEntry<LoadedPolicy[]>>();

/** Clear caches — for tests and after settings writes. */
export function __clearPolicyGateCaches() {
  modeCache = null;
  policiesCache.clear();
}

export async function loadEnforcementMode(): Promise<PolicyEnforcementMode> {
  const now = Date.now();
  if (modeCache && modeCache.expiresAt > now) return modeCache.value;
  let raw: string | null;
  try {
    raw = await getSetting("policy_enforcement_mode");
  } catch (err) {
    // Fail closed: serve the last known mode rather than degrading to "off";
    // with no cache at all, propagate so the caller refuses the request.
    if (modeCache) {
      console.error("loadEnforcementMode: DB error, serving stale cached mode:", err);
      return modeCache.value;
    }
    throw err;
  }
  const value = parseEnforcementMode(raw);
  modeCache = { value, expiresAt: now + MODE_TTL_MS };
  return value;
}

/** ACTIVE policies assigned to a system that carry at least one runtime rule. */
export async function loadPoliciesForSystem(aiSystemId: string): Promise<LoadedPolicy[]> {
  const now = Date.now();
  const cached = policiesCache.get(aiSystemId);
  if (cached && cached.expiresAt > now) return cached.value;

  let assignments;
  try {
    assignments = await prisma.policyAssignment.findMany({
      where: { aiSystemId },
      include: { policy: { select: { id: true, name: true, rules: true, status: true } } },
    });
  } catch (err) {
    if (cached) {
      console.error("loadPoliciesForSystem: DB error, serving stale cached policies:", err);
      return cached.value;
    }
    throw err;
  }

  const loaded: LoadedPolicy[] = [];
  for (const assignment of assignments) {
    if (assignment.policy.status !== "ACTIVE") continue;
    const rules = parsePolicyRules(assignment.policy.rules);
    const runtime = rules.runtime;
    if (!runtime || Object.keys(runtime).length === 0) continue;
    loaded.push({
      policyId: assignment.policy.id,
      policyName: assignment.policy.name,
      enforcement: rules.actions?.enforcement === "ADVISORY" ? "ADVISORY" : "BLOCK",
      runtime,
    });
  }
  policiesCache.set(aiSystemId, { value: loaded, expiresAt: now + POLICIES_TTL_MS });
  return loaded;
}

/** Concatenated text of a canonical (messages / system / prompt) request body. */
export function extractPromptText(bodyJson: Record<string, unknown> | null): string {
  if (!bodyJson) return "";
  const parts: string[] = [];
  if (typeof bodyJson.system === "string") parts.push(bodyJson.system);
  if (Array.isArray(bodyJson.messages)) {
    for (const msg of bodyJson.messages) {
      if (!msg || typeof msg !== "object") continue;
      const content = (msg as Record<string, unknown>).content;
      if (typeof content === "string") parts.push(content);
      else if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === "object" && typeof (block as Record<string, unknown>).text === "string") {
            parts.push((block as Record<string, unknown>).text as string);
          }
        }
      }
    }
  }
  if (typeof bodyJson.prompt === "string") parts.push(bodyJson.prompt);
  return parts.join("\n");
}

/**
 * Evaluate the loaded policies against one request. `deny` when any BLOCK
 * policy produced a violation; advisory violations are reported only.
 */
export async function evaluateRequest(input: {
  policies: LoadedPolicy[];
  aiSystemId: string | null;
  model: string;
  bodyJson: Record<string, unknown> | null;
}): Promise<{ decision: "allow" | "deny"; violations: Violation[] }> {
  if (!input.policies.length) return { decision: "allow", violations: [] };

  const promptText = extractPromptText(input.bodyJson);
  const rawMaxTokens = input.bodyJson?.max_tokens;
  const requestedMaxTokens =
    typeof rawMaxTokens === "number" && Number.isFinite(rawMaxTokens) ? rawMaxTokens : null;

  const needsRate = input.policies.some((p) => p.runtime.maxRequestsPerMinute);
  const needsCost = input.policies.some((p) => p.runtime.maxCostPerDay);
  let rateCount = 0;
  let costSum = 0;
  if (needsRate && input.aiSystemId) {
    rateCount = await prisma.aPIUsageLog
      .count({ where: { aiSystemId: input.aiSystemId, createdAt: { gte: new Date(Date.now() - 60_000) } } })
      .catch(() => 0);
  }
  if (needsCost && input.aiSystemId) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    costSum = await prisma.aPIUsageLog
      .aggregate({
        where: { aiSystemId: input.aiSystemId, createdAt: { gte: startOfDay } },
        _sum: { cost: true },
      })
      .then((r) => r._sum.cost ?? 0)
      .catch(() => 0);
  }

  const violations: Violation[] = [];
  let anyBlocking = false;
  for (const policy of input.policies) {
    const rules = policy.runtime;
    const push = (ruleKey: string, message: string) => {
      violations.push({ ruleKey, message, policyId: policy.policyId, policyName: policy.policyName });
      if (policy.enforcement === "BLOCK") anyBlocking = true;
    };
    const lc = input.model.toLowerCase();
    if (rules.allowedModelsRuntime?.length && !rules.allowedModelsRuntime.some((m) => lc.includes(m.toLowerCase()))) {
      push("model_not_allowed", `Model "${input.model}" is not in the allowed list for policy "${policy.policyName}".`);
    }
    if (rules.blockedModelsRuntime?.some((m) => lc.includes(m.toLowerCase()))) {
      push("model_blocked", `Model "${input.model}" matches a blocked pattern in policy "${policy.policyName}".`);
    }
    if (rules.maxOutputTokens && requestedMaxTokens !== null && requestedMaxTokens > rules.maxOutputTokens) {
      push(
        "max_output_tokens_exceeded",
        `Requested max_tokens=${requestedMaxTokens} exceeds the limit of ${rules.maxOutputTokens} set by policy "${policy.policyName}".`
      );
    }
    if (rules.maxRequestsPerMinute && rateCount >= rules.maxRequestsPerMinute) {
      push(
        "rate_limit_exceeded",
        `Rate limit of ${rules.maxRequestsPerMinute} requests/minute hit for policy "${policy.policyName}" (saw ${rateCount} in last 60s).`
      );
    }
    if (rules.maxCostPerDay && costSum >= rules.maxCostPerDay) {
      push(
        "cost_cap_exceeded",
        `Daily cost of $${costSum.toFixed(2)} has met the cap of $${rules.maxCostPerDay.toFixed(2)} set by policy "${policy.policyName}".`
      );
    }
    if (rules.blockedPromptPatterns?.length && promptText) {
      for (const source of rules.blockedPromptPatterns) {
        // Policies saved before the editor screened patterns may still hold a
        // catastrophic one; skip it rather than let it stall the proxy.
        if (!isSafeRuntimePattern(source)) continue;
        const re = new RegExp(source, "i");
        if (re.test(promptText.slice(0, MAX_PROMPT_SCAN_CHARS))) {
          push("prompt_pattern_blocked", `Prompt matched blocked pattern /${source}/i in policy "${policy.policyName}".`);
          break;
        }
      }
    }
  }
  return { decision: anyBlocking ? "deny" : "allow", violations };
}

export type PolicyGateInput = {
  /** `APIUsageLog.provider` value for the denial row. */
  provider: string;
  model: string;
  aiSystemId: string | null;
  userEmail: string | null;
  department: string | null;
  /** Canonical body — `policyViewOf(canonicalizeRequest(...))`. */
  policyBody: Record<string, unknown> | null;
  isStreaming: boolean;
  requestMetadata?: Record<string, unknown>;
};

/**
 * Run the gate. Returns the response to send instead of forwarding (403 on an
 * enforced denial, 503 when policy state cannot be loaded), or null to
 * proceed. With no `aiSystemId` there is nothing to evaluate against.
 */
export async function runPolicyGate(input: PolicyGateInput): Promise<NextResponse | null> {
  if (!input.aiSystemId) return null;

  let mode: PolicyEnforcementMode = "off";
  let policies: LoadedPolicy[] = [];
  try {
    mode = await loadEnforcementMode();
    if (mode !== "off") policies = await loadPoliciesForSystem(input.aiSystemId);
  } catch (err) {
    console.error("Policy state unavailable — failing closed:", err);
    return NextResponse.json(
      {
        error: {
          type: "policy_unavailable",
          message: "Policy enforcement state could not be loaded; request refused. Retry shortly.",
        },
      },
      { status: 503 }
    );
  }
  if (mode === "off" || policies.length === 0) return null;

  const evaluation = await evaluateRequest({
    policies,
    aiSystemId: input.aiSystemId,
    model: input.model,
    bodyJson: input.policyBody,
  });
  if (evaluation.decision !== "deny") return null;

  // The denial that fires is usually the one *because* of a secret or PII, so
  // the excerpt goes through the same redaction as the other stored excerpts
  // and stays short.
  const promptExcerpt = (sanitizeText(extractPromptText(input.policyBody)) ?? "").slice(0, 220);
  void prisma.policyDenial
    .create({
      data: {
        provider: input.provider,
        model: input.model,
        aiSystemId: input.aiSystemId,
        userEmail: input.userEmail,
        department: input.department,
        mode: mode === "enforce" ? "enforced" : "dryrun",
        policyIds: Array.from(new Set(evaluation.violations.map((v) => v.policyId))),
        reasons: JSON.parse(JSON.stringify(evaluation.violations)),
        promptExcerpt: promptExcerpt || null,
        requestMetadata: JSON.parse(
          JSON.stringify({ isStreaming: input.isStreaming, ...(input.requestMetadata ?? {}) })
        ),
      },
    })
    .catch((err) => {
      console.error("logPolicyDenial failed:", err);
    });

  if (mode !== "enforce") return null;
  return NextResponse.json(
    {
      error: {
        type: "policy_denied",
        message: "Request blocked by governance policy. See `violations` for details.",
        violations: evaluation.violations.map((v) => ({
          rule: v.ruleKey,
          message: v.message,
          policy: v.policyName,
        })),
      },
    },
    { status: 403 }
  );
}
