import { requireRole } from "@/lib/auth-guard";
import { UserManagement } from "@/components/settings/user-management";
import {
  DirectorySyncSettings,
  type DirectorySyncCardData,
} from "@/components/settings/directory-sync-settings";
import { prisma } from "@/lib/prisma";
import { managedUserSelect, serializeManagedUser } from "@/lib/user-lifecycle";
import { getDirectorySyncStatuses } from "@/lib/background-jobs";
import { getDirectoryPeopleCounts } from "@/lib/directory-sync";
import { getSettingsPageData } from "../data";

export default async function UserSettingsPage() {
  const session = await requireRole(["ADMIN"]);
  const [{ settingsMap }, users, directoryStatuses, directoryCounts] = await Promise.all([
    getSettingsPageData(),
    prisma.user.findMany({
      where: { status: { not: "DELETED" } },
      orderBy: { createdAt: "desc" },
      select: managedUserSelect,
    }),
    getDirectorySyncStatuses(),
    getDirectoryPeopleCounts(),
  ]);

  const directorySources: DirectorySyncCardData[] = directoryStatuses.map((status) => ({
    source: status.source,
    label: status.label,
    configured: status.configured,
    enabled: status.schedule.enabled,
    intervalHours: status.schedule.intervalHours,
    nextDueAt: status.schedule.nextDueAt ? status.schedule.nextDueAt.toISOString() : null,
    skippedReason: status.schedule.skippedReason ?? null,
    lastRun: status.lastRun
      ? {
          status: status.lastRun.status,
          startedAt: status.lastRun.startedAt.toISOString(),
          completedAt: status.lastRun.completedAt ? status.lastRun.completedAt.toISOString() : null,
          errorMessage: status.lastRun.errorMessage,
          counts: status.lastRun.counts,
        }
      : null,
    people: directoryCounts[status.source],
  }));

  return (
    <div className="space-y-6">
      <DirectorySyncSettings
        sources={directorySources}
        includeGuests={settingsMap.directory_sync_include_guests === "true"}
      />
      <UserManagement
        initialUsers={users.map(serializeManagedUser)}
        currentUserId={session.user.userId}
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
