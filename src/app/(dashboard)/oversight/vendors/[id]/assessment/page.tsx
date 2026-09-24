import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { VendorAssessmentWizard } from "@/components/vendors/vendor-assessment-wizard";
import { StartVendorAssessment } from "@/components/vendors/start-vendor-assessment";
import { getSession } from "@/lib/auth-guard";
import { canRunWorkflows } from "@/lib/workflow";
import { VENDOR_QUESTION_SECTIONS, VENDOR_QUESTIONS, parseVendorAnswers } from "@/lib/vendor-questionnaire";

export const dynamic = "force-dynamic";

export default async function VendorAssessmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const [{ id }, { step }, session] = await Promise.all([params, searchParams, getSession()]);
  if (!canRunWorkflows(session?.user.role)) redirect(`/oversight/vendors/${id}`);

  const profile = await prisma.vendorProfile.findUnique({
    where: { id },
    select: {
      id: true,
      vendor: true,
      assessments: {
        where: { status: "IN_PROGRESS" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!profile) notFound();

  const inProgress = profile.assessments[0];
  const answers = inProgress ? parseVendorAnswers(inProgress.answers) : {};
  // Resume at the first section with unanswered questions unless a step was asked for.
  const resumeStep =
    step ??
    VENDOR_QUESTION_SECTIONS.find((section) => section.questions.some((q) => !answers[q.id]))?.id ??
    "review";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${profile.vendor} risk questionnaire`}
        description={`${VENDOR_QUESTIONS.length} questions across ${VENDOR_QUESTION_SECTIONS.length} sections on security, data handling and contracts`}
      >
        <Link href={`/oversight/vendors/${profile.id}`}>
          <Badge variant="info">Back to vendor</Badge>
        </Link>
      </PageHeader>
      {inProgress ? (
        <VendorAssessmentWizard
          profileId={profile.id}
          vendor={profile.vendor}
          assessmentId={inProgress.id}
          initialAnswers={answers}
          initialStepId={resumeStep}
        />
      ) : (
        <StartVendorAssessment profileId={profile.id} vendor={profile.vendor} />
      )}
    </div>
  );
}
