import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-guard";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { HelpProvider } from "@/components/help/help-context";
import { HelpDrawer } from "@/components/help/help-drawer";

// Every dashboard route is auth-gated, per-user, and renders live data from
// the database — none should be statically prerendered. Forcing dynamic for
// the whole section keeps `next build` from instantiating PrismaClient at
// build time, where the DB env vars are unavailable (they're Vercel
// "Sensitive" vars, exposed only at runtime). Inherited by all child routes.
export const dynamic = "force-dynamic";

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
