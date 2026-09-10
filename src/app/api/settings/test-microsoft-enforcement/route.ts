import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import {
  isMicrosoft365Configured,
  getMicrosoftGrantedAppRoles,
} from "@/lib/microsoft-365-shadow-ai";

// The Graph application permission required to disable an enterprise app
// (PATCH /servicePrincipals/{id} accountEnabled=false).
const REQUIRED_ROLE = "Application.ReadWrite.All";

export async function POST() {
  return withRole(["ADMIN"], async () => {
    if (!(await isMicrosoft365Configured())) {
      return NextResponse.json({
        success: false,
        error: "Microsoft 365 isn't configured (tenant ID, client ID, and client secret required).",
      });
    }

    try {
      const roles = await getMicrosoftGrantedAppRoles();
      const hasPermission = roles.includes(REQUIRED_ROLE);
      return NextResponse.json({
        success: true,
        hasPermission,
        message: hasPermission
          ? `${REQUIRED_ROLE} is consented — blocking will disable Entra sign-ins to the app.`
          : `${REQUIRED_ROLE} is NOT consented, so blocks can't disable apps. Grant it on the app registration in Entra ID and admin-consent.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({
        success: false,
        error: `Could not verify permissions: ${message}`,
      });
    }
  });
}
