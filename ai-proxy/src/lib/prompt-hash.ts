/**
 * Prompt hashing for cross-surface correlation.
 *
 * MIRROR: this file is copied byte-for-byte to `ai-proxy/src/lib/prompt-hash.ts`
 * because the Azure Functions project cannot import from the Next.js app.
 * Edit here, then copy over the mirror — the hash of a prompt must be the
 * same whichever surface (Vercel proxy, Azure proxy, Claude Code events,
 * Cursor traces) computed it, or correlation silently breaks.
 *
 * What is hashed: the user-authored prompt text (see extractUserPromptText),
 * capped at PROMPT_HASH_MAX_CHARS, then normalized — trimmed, runs of
 * whitespace collapsed to one space, lower-cased. The hash is a keyed
 * HMAC-SHA256 truncated to PROMPT_HASH_LENGTH hex chars, so the same prompt
 * hashes the same across surfaces but a stored hash cannot be brute-forced
 * back to a prompt without the salt. Neither the prompt nor the salt is ever
 * persisted; only the hash is.
 */
import { createHmac } from "crypto";

/** AppSetting key (and, upper-cased, the env var) holding the HMAC salt. */
export const PROMPT_HASH_SETTING_KEY = "prompt_hash_salt";

/** Same cap the risk analyzer applies before scanning, so both see one text. */
export const PROMPT_HASH_MAX_CHARS = 8000;

/** Hex chars kept from the HMAC digest (128 bits). */
export const PROMPT_HASH_LENGTH = 32;

/** Trim, collapse whitespace to single spaces, lower-case. */
export function normalizePromptForHash(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * First PROMPT_HASH_LENGTH hex chars of HMAC-SHA256(salt, normalizedPrompt).
 * Returns null when there is no prompt text (after normalization) or no salt —
 * an unsalted hash would be a dictionary-attackable fingerprint of the prompt.
 */
export function computePromptHash(
  salt: string | null | undefined,
  prompt: string | null | undefined
): string | null {
  if (!salt) return null;
  if (typeof prompt !== "string") return null;
  const normalized = normalizePromptForHash(prompt.slice(0, PROMPT_HASH_MAX_CHARS));
  if (!normalized) return null;
  return createHmac("sha256", salt).update(normalized, "utf8").digest("hex").slice(0, PROMPT_HASH_LENGTH);
}

/** First non-empty candidate, so callers can express a fallback chain. */
export function resolvePromptHashSalt(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectUserTextBlocks(blocks: unknown, acc: string[]) {
  if (typeof blocks === "string") {
    acc.push(blocks);
    return;
  }
  if (!Array.isArray(blocks)) return;
  for (const block of blocks) {
    if (typeof block === "string") {
      acc.push(block);
      continue;
    }
    if (!isRecord(block)) continue;
    // Tool results and tool invocations are not user-authored text.
    if (block.type === "tool_result" || block.type === "tool_use") continue;
    if (block.type === "text" && typeof block.text === "string") {
      acc.push(block.text);
    }
  }
}

/**
 * Extract only **user-authored** text from a Messages / Chat Completions
 * request body. `system` / `instructions`, assistant turns, tool messages and
 * tool_result / tool_use blocks are skipped — they are developer- or model-
 * controlled, not what the person typed. A bare `prompt` field (legacy and
 * the OTel ingest routes) is treated as user text. Capped at
 * PROMPT_HASH_MAX_CHARS. Used both for risk analysis and for the prompt hash
 * so the two always see the same text.
 */
export function extractUserPromptText(
  requestBody: Record<string, unknown> | null | undefined
): string {
  if (!requestBody) return "";
  const parts: string[] = [];

  const messages = requestBody.messages;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (!isRecord(msg)) continue;
      if (msg.role !== "user") continue;
      collectUserTextBlocks(msg.content, parts);
    }
  }

  if (typeof requestBody.prompt === "string") {
    parts.push(requestBody.prompt);
  }

  return parts.join("\n").slice(0, PROMPT_HASH_MAX_CHARS);
}
