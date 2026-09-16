/**
 * Non-secret AppSetting reader for the Azure Functions proxy, with an env-var
 * fallback and a short in-memory TTL (per function instance). Used for the
 * Azure OpenAI endpoint and deployment map, which admins edit in
 * Settings → Proxy Setup in the main app.
 */
import { prisma } from "./db";

type CacheEntry = { value: string | null; expiresAt: number };
const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export async function loadSetting(key: string, envVar?: string): Promise<string | null> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  let value: string | null = null;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    value = row?.value ?? null;
  } catch (err) {
    console.error(`loadSetting(${key}) failed; falling back to env:`, err);
    if (cached) return cached.value;
  }
  if (value === null && envVar) value = process.env[envVar] ?? null;
  cache.set(key, { value, expiresAt: now + TTL_MS });
  return value;
}

export function __clearSettingsCache() {
  cache.clear();
}
