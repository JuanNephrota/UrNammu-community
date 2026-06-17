import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { getSetting, HEXNODE_SETTINGS_KEYS } from "@/lib/settings";
import { hexnodeGet, isHexnodeConfigured } from "@/lib/hexnode";

export async function POST() {
  return withRole(["ADMIN"], async () => {
    if (!(await isHexnodeConfigured())) {
      return NextResponse.json({
        success: false,
        error:
          "Missing configuration. Both API Key and Account Subdomain are required.",
      });
    }

    const apiKey = await getSetting(HEXNODE_SETTINGS_KEYS.API_KEY);
    const subdomainRaw = await getSetting(HEXNODE_SETTINGS_KEYS.SUBDOMAIN);
    const subdomain = (subdomainRaw ?? "")
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/\.hexnodemdm\.com$/i, "")
      .replace(/\.$/, "")
      .toLowerCase();

    try {
      // A lightweight, paginated read of a single device validates both the
      // subdomain (host resolves) and the API key (request authorizes).
      const data = await hexnodeGet<{ count?: number }>(
        { apiKey: apiKey ?? "", subdomain },
        "/devices/?limit=1"
      );

      const count = typeof data.count === "number" ? data.count : undefined;
      return NextResponse.json({
        success: true,
        message: `Connected to ${subdomain}.hexnodemdm.com${
          count !== undefined ? ` — ${count} managed device(s) visible` : ""
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
