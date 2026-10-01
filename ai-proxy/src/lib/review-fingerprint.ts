// MIRROR of src/lib/review-fingerprint.ts — the ai-proxy is a separate project and
// cannot import from the Next.js app. Keep byte-identical below this header.
/**
 * Fingerprints for withheld tool calls, so a pending review collapses
 * identical re-runs and an "exact" waiver matches the same call again.
 *
 * Pure apart from Node's crypto; shared (by copy) with the Azure proxy —
 * `ai-proxy/src/lib/review-fingerprint.ts` is a byte-identical mirror. Kept
 * out of `human-review-triggers.ts` because that module is also bundled into
 * client components, where `crypto` is unavailable.
 */
import { createHash } from "crypto";
import type { HumanReviewMatch } from "./human-review-triggers";

/** JSON with object keys sorted recursively, so argument order never matters. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** One call: tool label + canonical arguments. */
export function toolCallFingerprint(use: { serverName: string | null; toolName: string; input?: unknown }): string {
  const tool = use.serverName ? `${use.serverName}/${use.toolName}` : use.toolName;
  return sha256(`${tool}|${canonicalJson(use.input)}`);
}

/** The set of withheld matches, order-independent. */
export function reviewFingerprint(matches: HumanReviewMatch[]): string {
  const parts = [...new Set(matches.map((m) => toolCallFingerprint(m.use)))].sort();
  return sha256(parts.join("\n"));
}

export const MAX_STORED_ARGS = 4000;

/** What the reviewer sees: tool, trigger, detail and the (truncated) arguments. */
export function describeWithheldCalls(matches: HumanReviewMatch[]) {
  return matches.map((m) => {
    const input = canonicalJson(m.use.input);
    return {
      tool: m.tool,
      kind: m.use.kind,
      trigger: m.triggerLabel,
      detail: m.detail,
      input: input.length > MAX_STORED_ARGS ? `${input.slice(0, MAX_STORED_ARGS - 1)}…` : input,
      fingerprint: toolCallFingerprint(m.use),
    };
  });
}

export type WaiverLike = {
  id: string;
  waiverScope: string | null;
  fingerprint: string;
  triggers: string[];
  expiresAt: Date | string | null;
  usesRemaining: number | null;
};

/**
 * Does an approved waiver cover this match? "exact" waivers match a single
 * call's fingerprint (or the whole set's fingerprint for multi-call
 * approvals); "trigger" waivers match any call of the same trigger.
 */
export function waiverCovers(waiver: WaiverLike, match: HumanReviewMatch, setFingerprint: string, now = new Date()): boolean {
  if (waiver.expiresAt && new Date(waiver.expiresAt).getTime() <= now.getTime()) return false;
  if (waiver.usesRemaining !== null && waiver.usesRemaining <= 0) return false;
  if (waiver.waiverScope === "trigger") return waiver.triggers.includes(match.triggerLabel);
  return waiver.fingerprint === setFingerprint || waiver.fingerprint === toolCallFingerprint(match.use);
}
