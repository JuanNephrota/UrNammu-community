import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import { getSetting } from "@/lib/settings";
import { loadNetworkRuleSet } from "@/lib/network-rules-loader";
import {
  evaluateNetworkTarget,
  isForbiddenHostname,
  parseNetworkProxyMode,
  parseNetworkTarget,
} from "@/lib/network-rules";

/**
 * Dry-run a URL against the current rules: `GET /api/network-rules/test?url=…`.
 * Reads the rules fresh (no cache) so an admin sees the effect of an edit
 * immediately. Does not resolve DNS or contact the host.
 */
export async function GET(req: NextRequest) {
  return withAuth(async () => {
    const raw = new URL(req.url).searchParams.get("url")?.trim() ?? "";
    if (!raw) return NextResponse.json({ error: "Missing url" }, { status: 400 });

    let url: URL;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      return NextResponse.json({ error: "Not a valid URL" }, { status: 400 });
    }
    const authority = url.port ? `${url.hostname}:${url.port}` : url.hostname;
    const parsed = parseNetworkTarget(authority, url.pathname, url.search);
    if (!parsed.ok) {
      return NextResponse.json({
        url: url.toString(),
        decision: parsed.status === 403 ? "blocked" : "invalid",
        reason: parsed.error,
        source: parsed.status === 403 && isForbiddenHostname(url.hostname) ? "private_address" : null,
        rule: null,
      });
    }

    const [ruleSet, modeSetting] = [await loadNetworkRuleSet({ fresh: true }), await getSetting("network_proxy_mode")];
    const verdict = evaluateNetworkTarget(parsed.target, ruleSet.rules, ruleSet.shadowDomains);
    const mode = parseNetworkProxyMode(modeSetting);
    return NextResponse.json({
      url: parsed.target.url,
      mode,
      decision: verdict.allowed ? "allowed" : mode === "enforce" ? "blocked" : "monitored",
      source: verdict.source,
      rule: verdict.rule ? { id: verdict.rule.id, pattern: verdict.rule.pattern, action: verdict.rule.action, reason: verdict.rule.reason ?? null } : null,
      shadowDomain: verdict.shadowDomain,
      reason: verdict.allowed
        ? verdict.rule
          ? `Allowed by rule "${verdict.rule.pattern}".`
          : "No rule matches."
        : verdict.source === "shadow_ai"
          ? `"${verdict.shadowDomain}" is a Shadow AI discovery marked Blocked.`
          : `Matches block rule "${verdict.rule?.pattern}"${verdict.rule?.reason ? `: ${verdict.rule.reason}` : "."}`,
    });
  });
}
