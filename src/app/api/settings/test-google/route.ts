import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { getSetting, GOOGLE_SETTINGS_KEYS } from "@/lib/settings";

export async function POST() {
  return withRole(["ADMIN"], async () => {
    const serviceAccountKey = await getSetting(GOOGLE_SETTINGS_KEYS.SERVICE_ACCOUNT_KEY);
    const adminEmail = await getSetting(GOOGLE_SETTINGS_KEYS.ADMIN_EMAIL);

    if (!serviceAccountKey || !adminEmail) {
      return NextResponse.json({
        success: false,
        error: "Missing configuration. Both Service Account Key and Admin Email are required.",
      });
    }

    try {
      // Parse the key to validate format
      let key: { client_email?: string; private_key?: string };
      if (serviceAccountKey.startsWith("{")) {
        key = JSON.parse(serviceAccountKey);
      } else {
        key = JSON.parse(Buffer.from(serviceAccountKey, "base64").toString("utf-8"));
      }

      if (!key.client_email || !key.private_key) {
        return NextResponse.json({
          success: false,
          error: "Invalid service account key: missing client_email or private_key fields.",
        });
      }

      // Try to authenticate
      const { JWT } = await import("google-auth-library");
      const authClient = new JWT({
        email: key.client_email,
        key: key.private_key,
        scopes: [
          "https://www.googleapis.com/auth/admin.reports.audit.readonly",
          "https://www.googleapis.com/auth/admin.directory.user.security",
        ],
        subject: adminEmail,
      });

      await authClient.authorize();

      return NextResponse.json({
        success: true,
        message: `Connected successfully as ${key.client_email} (impersonating ${adminEmail})`,
        serviceAccount: key.client_email,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({
        success: false,
        error: `Authentication failed: ${message}`,
      });
    }
  });
}
