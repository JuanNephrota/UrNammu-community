/**
 * Prompt-hash salt loader for the Azure Functions proxy.
 *
 * Reads the same `prompt_hash_salt` AppSetting the main app uses (see
 * `src/lib/prompt-risk.ts` → loadPromptHashSalt), falling back to the
 * PROMPT_HASH_SALT env var and then NEXTAUTH_SECRET — the identical chain, so
 * a prompt hashed here matches the hash the Vercel proxies and the OTel
 * ingest routes compute. Cached per instance; a DB error serves the env
 * fallback (or the last cached value) rather than blocking the request.
 */
import { prisma } from "./db";
import { PROMPT_HASH_SETTING_KEY, resolvePromptHashSalt } from "./prompt-hash";

const SALT_TTL_MS = 60_000;

let saltCache: { value: string | null; expiresAt: number } | null = null;

export async function loadPromptHashSalt(): Promise<string | null> {
  const now = Date.now();
  if (saltCache && saltCache.expiresAt > now) return saltCache.value;

  let configured: string | null = null;
  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: PROMPT_HASH_SETTING_KEY },
      select: { value: true },
    });
    configured = row?.value ?? null;
  } catch (err) {
    if (saltCache) {
      console.error("loadPromptHashSalt: DB error, serving cached salt:", err);
      saltCache = { value: saltCache.value, expiresAt: now + SALT_TTL_MS };
      return saltCache.value;
    }
    console.error("loadPromptHashSalt: DB error, falling back to env:", err);
  }

  const value = resolvePromptHashSalt(
    configured,
    process.env.PROMPT_HASH_SALT,
    process.env.NEXTAUTH_SECRET
  );
  saltCache = { value, expiresAt: now + SALT_TTL_MS };
  return value;
}

export function __clearPromptHashSaltCache() {
  saltCache = null;
}
