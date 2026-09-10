/**
 * Identity-layer enforcement for blocked shadow AI tools.
 *
 * When a discovery is BLOCKED, this revokes/disables the tool's access at the
 * identity provider so the block actually stops sign-ins — complementary to the
 * network-layer blocklist feed (src/lib/shadow-blocklist.ts), which blocks by
 * domain. Identity enforcement only governs apps federated to the IdP (Sign in
 * with Google / Microsoft); a tool reached with a personal account is invisible
 * here and must be caught by the network feed.
 *
 * Targeting requires the IdP app handle captured at scan time
 * (DiscoveredAITool.externalAppId / externalAppProvider). Tools without one
 * can't be enforced and return a `skipped` result.
 */

import { isMicrosoft365Configured, setMicrosoftAppEnabled } from "./microsoft-365-shadow-ai";
import { isGoogleWorkspaceConfigured, revokeGoogleAppAccess } from "./google-workspace";

export type IdentityEnforcementAction =
  | "blocked" // app access disabled at the IdP
  | "unblocked" // app access restored at the IdP
  | "skipped" // no app handle captured — nothing to target
  | "unsupported" // provider can't be enforced programmatically yet
  | "not_configured" // provider integration isn't set up
  | "failed"; // the IdP call errored (e.g. missing permission)

export type IdentityEnforcementResult = {
  enforced: boolean;
  provider: string | null;
  action: IdentityEnforcementAction;
  message: string;
};

type EnforceableTool = {
  toolName: string;
  externalAppId: string | null;
  externalAppProvider: string | null;
};

/**
 * Block or unblock a discovered tool at its identity provider. Best-effort: the
 * caller should not fail the status change if this returns `failed` — surface
 * the message instead so an admin can act manually.
 */
export async function enforceIdentityBlock(
  tool: EnforceableTool,
  block: boolean
): Promise<IdentityEnforcementResult> {
  const provider = tool.externalAppProvider;

  if (!tool.externalAppId || !provider) {
    return {
      enforced: false,
      provider: provider ?? null,
      action: "skipped",
      message:
        "No identity-provider app handle was captured for this tool, so its sign-ins can't be blocked automatically. The network blocklist feed still applies.",
    };
  }

  if (provider === "microsoft_365") {
    if (!(await isMicrosoft365Configured())) {
      return {
        enforced: false,
        provider,
        action: "not_configured",
        message: "Microsoft 365 isn't configured, so the app's sign-ins can't be changed.",
      };
    }
    try {
      await setMicrosoftAppEnabled(tool.externalAppId, !block);
      return {
        enforced: true,
        provider,
        action: block ? "blocked" : "unblocked",
        message: block
          ? `Disabled "${tool.toolName}" in Entra ID — sign-ins to the app are now blocked.`
          : `Re-enabled "${tool.toolName}" in Entra ID — sign-ins to the app are restored.`,
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Unknown Graph error";
      return {
        enforced: false,
        provider,
        action: "failed",
        message: `Could not ${block ? "disable" : "enable"} the app in Entra ID: ${detail}. Confirm the integration has Application.ReadWrite.All admin-consented.`,
      };
    }
  }

  if (provider === "google_workspace") {
    // Google exposes no per-app *block* API (Cloud Identity policy settings are
    // org-wide and read-only), so we revoke the app's existing OAuth grants —
    // which invalidates its refresh tokens. There is no programmatic "un-revoke":
    // restoring access is the user re-authorizing.
    if (!block) {
      return {
        enforced: false,
        provider,
        action: "unsupported",
        message:
          "Google access can't be programmatically restored — affected users must re-authorize the app themselves.",
      };
    }
    if (!(await isGoogleWorkspaceConfigured())) {
      return {
        enforced: false,
        provider,
        action: "not_configured",
        message: "Google Workspace isn't configured, so the app's OAuth grants can't be revoked.",
      };
    }
    try {
      const { usersTargeted, tokensRevoked, errors, capped } =
        await revokeGoogleAppAccess(tool.externalAppId);

      if (usersTargeted === 0) {
        return {
          enforced: false,
          provider,
          action: "skipped",
          message: `No active "${tool.toolName}" OAuth grants were found in the audit window, so there was nothing to revoke.`,
        };
      }

      const note =
        " Google has no per-app block API, so users can re-authorize — to prevent re-consent, set Admin console → Security → API controls to block all unconfigured third-party apps.";
      return {
        enforced: tokensRevoked > 0,
        provider,
        action: tokensRevoked > 0 ? "blocked" : "failed",
        message:
          `Revoked "${tool.toolName}" OAuth access for ${tokensRevoked}/${usersTargeted} Google user(s)` +
          `${errors ? `, ${errors} failed` : ""}` +
          `${capped ? " (capped this run — re-run to continue)" : ""}.` +
          note,
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Unknown Directory API error";
      return {
        enforced: false,
        provider,
        action: "failed",
        message: `Could not revoke the app's Google OAuth grants: ${detail}.`,
      };
    }
  }

  return {
    enforced: false,
    provider,
    action: "unsupported",
    message: `Identity enforcement isn't supported for provider "${provider}".`,
  };
}
