import { PageHeader } from "@/components/layout/page-header";
import { SettingsNav } from "@/components/settings/settings-nav";
import { getSettingsPageData } from "./data";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAdmin } = await getSettingsPageData();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Configuration, integrations, and operational controls"
      />
      <SettingsNav isAdmin={isAdmin} />
      {children}
    </div>
  );
}
