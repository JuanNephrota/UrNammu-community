/**
 * Runtime policy-as-code evaluator for the Azure Functions proxy.
 *
 * Deliberately duplicated from the main app's `src/lib/policy-rules.ts` — the
 * proxy is a separate deploy with its own dependency tree and can't import
 * from Next.js source. Keep the two in sync by convention; the shape of
 * `PolicyRuntimeRules` must match.
 */

import { prisma } from "./db";
import type { LoadedPolicy } from "./policy-loader";

export type PolicyRuntimeRules = {
  allowedModelsRuntime?: string[];
  blockedModelsRuntime?: string[];
  maxOutputTokens?: number;
  maxRequestsPerMinute?: number;
  maxCostPerDay?: number;
  blockedPromptPatterns?: string[];
};

export type Violation = {
  ruleKey: string;
  message: string;
  policyId: string;
  policyName: string;
};

export type EvaluationResult = {
  decision: "allow" | "deny";
  violations: Violation[];
};

/** Parse the `runtime` sub-object from the policy's JSON rules blob. */
export function parseRuntimeRules(rules: unknown): PolicyRuntimeRules | null {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return null;
  const runtime = (rules as Record<string, unknown>).runtime;
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) return null;

  const input = runtime as Record<string, unknown>;
  const out: PolicyRuntimeRules = {};

  const copyStringArray = (key: keyof PolicyRuntimeRules) => {
    const candidate = input[key];
    if (Array.isArray(candidate)) {
      const values = candidate.filter(
        (v): v is string => typeof v === "string" && v.trim().length > 0
      );
      if (values.length) (out[key] as string[] | undefined) = values;
    }
  };

  copyStringArray("allowedModelsRuntime");
  copyStringArray("blockedModelsRuntime");

  if (Array.isArray(input.blockedPromptPatterns)) {
    const valid = (input.blockedPromptPatterns as unknown[]).filter(
      (entry): entry is string => {
        if (typeof entry !== "string" || !entry.trim().length) return false;
        try {
          new RegExp(entry, "i");
          return true;
        } catch {
          return false;
        }
      }
    );
    if (valid.length) out.blockedPromptPatterns = valid;
  }

  for (const key of ["maxOutputTokens", "maxRequestsPerMinute", "maxCostPerDay"] as const) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      out[key] = value;
    }
  }

  return Object.keys(out).length ? out : null;
}

/** Extract concatenated text content from a request body for regex matching. */
export function extractPromptText(bodyJson: Record<string, unknown> | null): string {
  if (!bodyJson) return "";
  const parts: string[] = [];

  const sys = bodyJson.system;
  if (typeof sys === "string") parts.push(sys);

  const messages = bodyJson.messages;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (!msg || typeof msg !== "object") continue;
      const content = (msg as Record<string, unknown>).content;
      if (typeof content === "string") {
        parts.push(content);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === "object" && typeof (block as Record<string, unknown>).text === "string") {
            parts.push(((block as Record<string, unknown>).text as string));
          }
        }
      }
    }
  }

  const prompt = bodyJson.prompt;
  if (typeof prompt === "string") parts.push(prompt);

  return parts.join("\n");
}

type EvaluationInput = {
  policies: LoadedPolicy[];
  aiSystemId: string | null;
  model: string;
  bodyJson: Record<string, unknown> | null;
};

/**
 * Evaluate every loaded policy against the request. Returns `deny` if any
 * policy with `enforcement: BLOCK` produced a violation. Advisory policies
 * surface violations but never drive the decision.
 */
export async function evaluateRequest(input: EvaluationInput): Promise<EvaluationResult> {
  if (!input.policies.length) return { decision: "allow", violations: [] };

  const promptText = extractPromptText(input.bodyJson);
  const rawMaxTokens = input.bodyJson?.max_tokens;
  const requestedMaxTokens =
    typeof rawMaxTokens === "number" && Number.isFinite(rawMaxTokens) ? rawMaxTokens : null;

  // Lazy-compute usage-window counts — only run the queries when at least one
  // policy asks for rate or cost caps, and only query once per request.
  let rateCountPromise: Promise<number> | null = null;
  let costSumPromise: Promise<number> | null = null;

  const needsRate = input.policies.some((p) => p.runtime.maxRequestsPerMinute);
  const needsCost = input.policies.some((p) => p.runtime.maxCostPerDay);

  if (needsRate && input.aiSystemId) {
    const since = new Date(Date.now() - 60_000);
    rateCountPromise = prisma.aPIUsageLog
      .count({ where: { aiSystemId: input.aiSystemId, createdAt: { gte: since } } })
      .catch(() => 0);
  }
  if (needsCost && input.aiSystemId) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    costSumPromise = prisma.aPIUsageLog
      .aggregate({
        where: { aiSystemId: input.aiSystemId, createdAt: { gte: startOfDay } },
        _sum: { cost: true },
      })
      .then((r) => r._sum.cost ?? 0)
      .catch(() => 0);
  }

  const rateCount = rateCountPromise ? await rateCountPromise : 0;
  const costSum = costSumPromise ? await costSumPromise : 0;

  const violations: Violation[] = [];
  let anyBlockingViolation = false;

  for (const policy of input.policies) {
    const rules = policy.runtime;
    const contextRaw: string[] = [];

    const push = (ruleKey: string, message: string) => {
      violations.push({
        ruleKey,
        message,
        policyId: policy.policyId,
        policyName: policy.policyName,
      });
      if (policy.enforcement === "BLOCK") anyBlockingViolation = true;
      contextRaw.push(ruleKey);
    };

    if (rules.allowedModelsRuntime?.length) {
      const lc = input.model.toLowerCase();
      if (!rules.allowedModelsRuntime.some((m) => lc.includes(m.toLowerCase()))) {
        push(
          "model_not_allowed",
          `Model "${input.model}" is not in the allowed list for policy "${policy.policyName}".`
        );
      }
    }
    if (rules.blockedModelsRuntime?.length) {
      const lc = input.model.toLowerCase();
      if (rules.blockedModelsRuntime.some((m) => lc.includes(m.toLowerCase()))) {
        push(
          "model_blocked",
          `Model "${input.model}" matches a blocked pattern in policy "${policy.policyName}".`
        );
      }
    }
    if (
      rules.maxOutputTokens &&
      requestedMaxTokens !== null &&
      requestedMaxTokens > rules.maxOutputTokens
    ) {
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
        let re: RegExp;
        try {
          re = new RegExp(source, "i");
        } catch {
          continue;
        }
        if (re.test(promptText)) {
          push(
            "prompt_pattern_blocked",
            `Prompt matched blocked pattern /${source}/i in policy "${policy.policyName}".`
          );
          break;
        }
      }
    }
  }

  return {
    decision: anyBlockingViolation ? "deny" : "allow",
    violations,
  };
}
