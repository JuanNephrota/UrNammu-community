import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EuAiActWizard } from "@/components/registry/eu-ai-act-wizard";
import { EMPTY_ANSWERS, normalizeAnswers } from "@/lib/eu-ai-act";

export default async function EuAiActWizardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const system = await prisma.aISystem.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      useCase: true,
      vendor: true,
      dataSensitivity: true,
      euAiActClassification: {
        select: { tier: true, classifiedAt: true, answers: true, notes: true },
      },
    },
  });
  if (!system) notFound();

  const existing = system.euAiActClassification;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`EU AI Act classification — ${system.name}`}
        description="Answer a short questionnaire to determine the system's risk tier under Regulation (EU) 2024/1689 and the articles you must evidence. Nothing is saved until the final step."
      >
        <Link href={`/registry/${system.id}`}>
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to system
          </Button>
        </Link>
      </PageHeader>

      <EuAiActWizard
        systemId={system.id}
        systemName={system.name}
        systemContext={{
          useCase: system.useCase,
          vendor: system.vendor,
          dataSensitivity: system.dataSensitivity,
        }}
        initialAnswers={existing ? normalizeAnswers(existing.answers) : EMPTY_ANSWERS}
        initialNotes={existing?.notes ?? null}
        existing={
          existing
            ? { tier: existing.tier, classifiedAt: new Date(existing.classifiedAt).toISOString() }
            : null
        }
      />
    </div>
  );
}
