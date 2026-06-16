import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { AUTH_SETTINGS_KEYS, PLATFORM_SETTINGS_KEYS, getSetting } from "@/lib/settings";

export async function POST() {
  return withRole(["ADMIN"], async () => {
    const [clientId, clientSecret, platformUrl] = await Promise.all([
      getSetting(AUTH_SETTINGS_KEYS.GOOGLE_CLIENT_ID),
      getSetting(AUTH_SETTINGS_KEYS.GOOGLE_CLIENT_SECRET),
      getSetting(PLATFORM_SETTINGS_KEYS.PLATFORM_URL),
    ]);

    if (!clientId || !clientSecret) {
      return NextResponse.json({
        success: false,
        error: "Missing configuration. Both Google client ID and client secret are required.",
      });
    }

    if (!clientId.endsWith(".apps.googleusercontent.com")) {
      return NextResponse.json({
        success: false,
        error: "The Google client ID format looks invalid. It should end with .apps.googleusercontent.com.",
      });
    }

    const baseUrl = (platformUrl ?? process.env.NEXTAUTH_URL ?? "http://localhost:3001").replace(/\/$/, "");
    const callbackUrl = `${baseUrl}/api/auth/callback/google`;

    return NextResponse.json({
      success: true,
      message: `Google sign-in is configured. Verify this redirect URI exists in Google Cloud: ${callbackUrl}`,
      callbackUrl,
    });
  });
}
