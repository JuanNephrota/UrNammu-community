import type { ProviderMeta } from "./providers";
import type { LiveFacts } from "./rules";
import { testAnthropicAdmin } from "../anthropic-admin";
import { testOpenAIAdmin } from "../openai-admin";

/**
 * Best-effort live verification of a provider's configuration.
 *
 * Provider admin APIs largely expose usage/members, not privacy toggles, so
 * the only signal we can reliably read live today is whether the configured
 * admin credential actually authenticates. Adapters fail soft: any error
 * degrades to `keyValid: false` with a note, never throws, so one provider's
 * outage can't break the whole scan. Providers without an adapter return a
 * non-run result and are scored on attestation/inference alone.
 */
export async function runLiveChecks(meta: ProviderMeta): Promise<LiveFacts> {
  if (!meta.hasLiveAdapter) return { ran: false };

  try {
    if (meta.id === "anthropic") {
      const res = await testAnthropicAdmin();
      return {
        ran: true,
        keyValid: res.success,
        organizationName: res.org ?? null,
        note: res.message,
      };
    }
    if (meta.id === "openai") {
      const res = await testOpenAIAdmin();
      return { ran: true, keyValid: res.success, note: res.message };
    }
  } catch (err) {
    return {
      ran: true,
      keyValid: false,
      note: err instanceof Error ? err.message : "Live verification failed",
    };
  }

  return { ran: false };
}
