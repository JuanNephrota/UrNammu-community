import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { VendorSetupWizard } from "@/components/vendors/vendor-setup-wizard";
import { getSession } from "@/lib/auth-guard";
import { canRunWorkflows, resolveStepId } from "@/lib/workflow";
import { VENDOR_SETUP_STEPS, toVendorSetupValues } from "@/lib/vendor-onboarding";
import { loadVendorProfile } from "@/lib/vendor-profile-data";

export const dynamic = "force-dynamic";

export default async function VendorSetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string; existing?: string }>;
}) {
  const [{ id }, { step, existing }, session] = await Promise.all([params, searchParams, getSession()]);
  if (!canRunWorkflows(session?.user.role)) redirect(`/oversight/vendors/${id}`);

  const profile = await loadVendorProfile(id);
  if (!profile) notFound();

  const systems = await prisma.aISystem.findMany({
    where: { vendor: { equals: profile.vendor, mode: "insensitive" }, useCase: { not: null } },
    select: { useCase: true },
  });
  const liveUseCases = [...new Set(systems.map((s) => s.useCase?.trim()).filter(Boolean) as string[])];

  return (
    <div className="space-y-6">
      <PageHeader title={`Set up ${profile.vendor}`} description="Complete the vendor profile one step at a time">
        <Link href={`/oversight/vendors/${profile.id}`}>
          <Badge variant="info">Back to vendor</Badge>
        </Link>
      </PageHeader>
      {existing && (
        <div className="rounded-lg border border-[var(--info-border)] bg-[var(--info-dim)] p-3 text-sm text-[var(--info)]">
          {profile.vendor} already has a profile, so you&rsquo;re editing it rather than creating a duplicate.
        </div>
      )}
      <VendorSetupWizard
        profileId={profile.id}
        initialValues={toVendorSetupValues(profile)}
        initialStepId={resolveStepId(VENDOR_SETUP_STEPS, step)}
        liveUseCases={liveUseCases}
      />
    </div>
  );
}
