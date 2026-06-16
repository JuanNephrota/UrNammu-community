import { requireRole } from "@/lib/auth-guard";
import { UserManagement } from "@/components/settings/user-management";
import { prisma } from "@/lib/prisma";
import { getSettingsPageData } from "../data";

export default async function UserSettingsPage() {
  await requireRole(["ADMIN"]);
  const [{ settingsMap }, users] = await Promise.all([
    getSettingsPageData(),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        accounts: { select: { provider: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <UserManagement
        initialUsers={users.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          department: user.department,
          createdAt: user.createdAt,
          hasLocalPassword: !!user.passwordHash,
          authProviders: user.accounts.map((account) => account.provider),
        }))}
        localAuthEnabled={
          settingsMap.enable_local_auth === "true" ||
          (settingsMap.enable_local_auth === null &&
            (process.env.ENABLE_LOCAL_AUTH === "true" ||
              (process.env.NODE_ENV !== "production" && process.env.ENABLE_LOCAL_AUTH !== "false") ||
              process.env.DEMO_MODE === "true"))
        }
        devLoginEnabled={
          settingsMap.enable_dev_login === "true" ||
          (settingsMap.enable_dev_login === null &&
            (process.env.ENABLE_DEV_LOGIN === "true" ||
              (process.env.NODE_ENV !== "production" && process.env.ENABLE_DEV_LOGIN !== "false")))
        }
        microsoftEnabled={
          (!!settingsMap.microsoft_client_id &&
            !!settingsMap.microsoft_client_secret &&
            !!settingsMap.microsoft_tenant_id) ||
          (!settingsMap.microsoft_client_id &&
            !settingsMap.microsoft_client_secret &&
            !settingsMap.microsoft_tenant_id &&
            !!process.env.MICROSOFT_CLIENT_ID &&
            !!process.env.MICROSOFT_CLIENT_SECRET &&
            !!process.env.MICROSOFT_TENANT_ID)
        }
        googleEnabled={
          (!!settingsMap.google_oauth_client_id && !!settingsMap.google_oauth_client_secret) ||
          (!settingsMap.google_oauth_client_id &&
            !settingsMap.google_oauth_client_secret &&
            !!process.env.GOOGLE_CLIENT_ID &&
            !!process.env.GOOGLE_CLIENT_SECRET)
        }
        authSettings={{
          enableLocalAuth: settingsMap.enable_local_auth ?? "",
          enableDevLogin: settingsMap.enable_dev_login ?? "",
          googleClientId: settingsMap.google_oauth_client_id ?? "",
          microsoftClientId: settingsMap.microsoft_client_id ?? "",
          microsoftTenantId: settingsMap.microsoft_tenant_id ?? "",
        }}
        platformUrl={settingsMap.platform_url ?? process.env.NEXTAUTH_URL ?? "http://localhost:3001"}
      />
    </div>
  );
}
