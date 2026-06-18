import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { getSetting, CROWDSTRIKE_SETTINGS_KEYS } from "@/lib/settings";
import {
  crowdstrikeGet,
  getCrowdStrikeToken,
  isCrowdStrikeConfigured,
  CROWDSTRIKE_DEFAULT_CLOUD,
} from "@/lib/crowdstrike";

export async function POST() {
  return withRole(["ADMIN"], async () => {
    if (!(await isCrowdStrikeConfigured())) {
      return NextResponse.json({
        success: false,
        error:
          "Missing configuration. Client ID, Client Secret, and API cloud are all required.",
      });
    }

    const [clientId, clientSecret, baseUrlRaw] = await Promise.all([
      getSetting(CROWDSTRIKE_SETTINGS_KEYS.CLIENT_ID),
      getSetting(CROWDSTRIKE_SETTINGS_KEYS.CLIENT_SECRET),
      getSetting(CROWDSTRIKE_SETTINGS_KEYS.BASE_URL),
    ]);

    const baseUrl = (baseUrlRaw ?? CROWDSTRIKE_DEFAULT_CLOUD)
      .trim()
      .replace(/\/+$/, "");
    const config = {
      clientId: clientId ?? "",
      clientSecret: clientSecret ?? "",
      baseUrl: /^https?:\/\//.test(baseUrl) ? baseUrl : `https://${baseUrl}`,
    };

    try {
      // Authenticating proves the client ID/secret are valid. A 1-record
      // application query then confirms the API client actually has the
      // Falcon Discover scope (otherwise it 403s) — surfacing the licensing
      // requirement immediately rather than at scan time.
      const token = await getCrowdStrikeToken(config);
      const data = await crowdstrikeGet<{
        meta?: { pagination?: { total?: number } };
      }>(config, token, "/falcon-discover/combined/applications/v1?limit=1");

      const total = data.meta?.pagination?.total;
      return NextResponse.json({
        success: true,
        message: `Connected to ${config.baseUrl}${
          typeof total === "number"
            ? ` — ${total} application record(s) visible in Falcon Discover`
            : ""
        }.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({
        success: false,
        error: `Connection failed: ${message}`,
      });
    }
  });
}
