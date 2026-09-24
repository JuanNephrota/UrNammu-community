import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { TriageWizard } from "@/components/shadow-ai/triage-wizard";
import { getSession } from "@/lib/auth-guard";
import { canRunWorkflows } from "@/lib/workflow";
import { categoryLabel, findKnownTool } from "@/lib/ai-tools-registry";

export const dynamic = "force-dynamic";

// The same rows, in the same order, as the Shadow AI "Needs Review" list.
const REVIEW_QUEUE_WHERE = {
  linkedSystemId: null,
  status: {
    in: ["DISCOVERED", "UNDER_REVIEW"] as ("DISCOVERED" | "UNDER_REVIEW")[],
  },
  OR: [{ matchConfidence: null }, { matchConfidence: "high" }],
};

export default async function TriagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, session] = await Promise.all([params, getSession()]);
  if (!canRunWorkflows(session?.user.role)) redirect("/shadow-ai");

  const tool = await prisma.discoveredAITool.findUnique({ where: { id } });
  if (!tool) notFound();

  const [vendorProfile, next] = await Promise.all([
    tool.vendor
      ? prisma.vendorProfile.findFirst({
          where: { vendor: { equals: tool.vendor, mode: "insensitive" } },
          select: { id: true, securityReviewStatus: true },
        })
      : null,
    prisma.discoveredAITool.findFirst({
      where: { ...REVIEW_QUEUE_WHERE, id: { not: tool.id } },
      orderBy: { detectedAt: "desc" },
      select: { id: true },
    }),
  ]);

  const known = findKnownTool(tool.toolName);
  const matchReasons = Array.isArray(tool.matchReasons)
    ? tool.matchReasons.filter(
        (reason): reason is string => typeof reason === "string",
      )
    : [];

  const linkedSystem = tool.linkedSystemId
    ? await prisma.aISystem.findUnique({
        where: { id: tool.linkedSystemId },
        select: { id: true, name: true },
      })
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Review ${tool.toolName}`}
        description="Decide what to do about a discovered AI tool"
      >
        <Badge variant={statusBadgeVariant(tool.status)}>
          {tool.status.replace(/_/g, " ")}
        </Badge>
        <Link href="/shadow-ai">
          <Badge variant="info">Back to Shadow AI</Badge>
        </Link>
      </PageHeader>

      {linkedSystem ? (
        <div className="rounded-lg border border-[var(--success-border)] bg-[var(--success-dim)] p-4 text-sm text-[var(--success-strong)]">
          Already registered as{" "}
          <Link href={`/registry/${linkedSystem.id}`} className="underline">
            {linkedSystem.name}
          </Link>
          , so it is governed there.
        </div>
      ) : (
        <TriageWizard
          tool={{
            id: tool.id,
            toolName: tool.toolName,
            vendor: tool.vendor,
            detectedDomain: tool.detectedDomain,
            detectionSource: tool.detectionSource,
            status: tool.status,
            categoryLabel: tool.category ? categoryLabel(tool.category) : null,
            userCount: tool.userCount,
            userEmails: tool.userEmails,
            scopes: tool.scopes,
            firstSeenAt: tool.firstSeenAt?.toISOString() ?? null,
            lastSeenAt: tool.lastSeenAt?.toISOString() ?? null,
            detectedAt: tool.detectedAt.toISOString(),
            matchConfidence: tool.matchConfidence,
            matchReasons,
            hasIdentityHandle: Boolean(
              tool.externalAppId && tool.externalAppProvider,
            ),
          }}
          riskHints={known?.riskHints ?? []}
          vendorProfile={vendorProfile}
          nextToolId={next?.id ?? null}
        />
      )}
    </div>
  );
}
