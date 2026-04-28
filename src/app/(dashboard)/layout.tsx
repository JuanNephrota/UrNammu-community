import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-guard";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { HelpProvider } from "@/components/help/help-context";
import { HelpDrawer } from "@/components/help/help-drawer";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <HelpProvider>
      <div className="flex h-screen overflow-hidden bg-[var(--bg-deep)]">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar />
          <main className="flex-1 overflow-y-auto p-6 lg:p-8">{children}</main>
        </div>
        <HelpDrawer />
      </div>
    </HelpProvider>
  );
}
