import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import {
  getMicrosoft365AccessToken,
  isMicrosoft365Configured,
} from "@/lib/microsoft-365-shadow-ai";

export async function POST() {
  return withRole(["ADMIN"], async () => {
    if (!(await isMicrosoft365Configured())) {
      return NextResponse.json({
        success: false,
        error:
          "Missing configuration. Tenant ID, Client ID, and Client Secret are required.",
      });
    }

    try {
      const accessToken = await getMicrosoft365AccessToken();
      const response = await fetch(
        "https://graph.microsoft.com/v1.0/organization?$top=1",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );
      const data = (await response.json()) as {
        value?: Array<{ displayName?: string; id?: string }>;
        error?: { message?: string };
      };

      if (!response.ok) {
        return NextResponse.json({
          success: false,
          error:
            data.error?.message ??
            `Microsoft Graph request failed with ${response.status}.`,
        });
      }

      const org = data.value?.[0];
      return NextResponse.json({
        success: true,
        message: `Connected successfully to Microsoft 365${org?.displayName ? ` (${org.displayName})` : ""}.`,
        organization: org ?? null,
      });
    } catch (err) {
      return NextResponse.json({
        success: false,
        error: `Authentication failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    }
  });
}
