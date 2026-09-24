import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { VendorSetupWizard } from "@/components/vendors/vendor-setup-wizard";
import { getSession } from "@/lib/auth-guard";
import { canRunWorkflows } from "@/lib/workflow";
import { listVendorsWithoutProfile } from "@/lib/vendor-profile-data";

export const dynamic = "force-dynamic";

export default async function NewVendorPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string }>;
}) {
  const [{ vendor }, session, knownVendors] = await Promise.all([
    searchParams,
    getSession(),
    listVendorsWithoutProfile(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Add vendor"
        description="Set up a governance profile for an AI vendor, then complete its risk questionnaire"
      >
        <Link href="/oversight/vendors">
          <Badge variant="info">Back to Vendor Governance</Badge>
        </Link>
      </PageHeader>

      {canRunWorkflows(session?.user.role) ? (
        <VendorSetupWizard
          initialStepId="identity"
          knownVendors={knownVendors}
          initialValues={{
            vendor: vendor?.slice(0, 200) ?? "",
            website: "",
            description: "",
            contractOwner: "",
            contractStatus: "UNKNOWN",
            contractStartDate: "",
            contractRenewalDate: "",
            renewalNoticeDays: 60,
            renewalNotes: "",
            dataResidency: [],
            subprocessors: [],
            approvedUseCases: [],
            notes: "",
          }}
        />
      ) : (
        <Card>
          <CardContent className="p-6 text-sm text-[var(--text-muted)]">
            Only admins and compliance officers can add vendors.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
