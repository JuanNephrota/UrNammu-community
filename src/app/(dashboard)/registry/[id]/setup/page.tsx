import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { SystemSetupWizard } from "@/components/registry/system-setup-wizard";
import { getSession } from "@/lib/auth-guard";
import { canRunWorkflows, resolveStepId } from "@/lib/workflow";
import { SYSTEM_SETUP_STEPS, toSystemSetupValues } from "@/lib/system-onboarding";
import { loadSystemSetupSuggestions } from "@/lib/system-setup-data";

export const dynamic = "force-dynamic";

export default async function SystemSetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const [{ id }, { step }, session] = await Promise.all([params, searchParams, getSession()]);
  if (!canRunWorkflows(session?.user.role)) redirect(`/registry/${id}`);

  const [system, suggestions] = await Promise.all([
    prisma.aISystem.findUnique({ where: { id } }),
    loadSystemSetupSuggestions(),
  ]);
  if (!system) notFound();

  return (
    <div className="space-y-6">
      <PageHeader title={`Set up ${system.name}`} description="Complete the system record one step at a time">
        <Link href={`/registry/${system.id}`}>
          <Badge variant="info">Back to system</Badge>
        </Link>
      </PageHeader>
      <SystemSetupWizard
        systemId={system.id}
        initialValues={toSystemSetupValues(system)}
        initialStepId={resolveStepId(SYSTEM_SETUP_STEPS, step)}
        {...suggestions}
      />
    </div>
  );
}
