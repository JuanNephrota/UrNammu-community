import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { AISkillForm } from "@/components/forms/ai-skill-form";

export default async function EditSkillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [skill, agents, systems] = await Promise.all([
    prisma.aISkill.findUnique({ where: { id } }),
    prisma.aIAgent.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.aISystem.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!skill) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit: ${skill.name}`}
        description={`Forge ID: ${skill.forgeId}`}
      >
        <Link href={`/registry/skills/${skill.id}`}>
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </Link>
      </PageHeader>

      <AISkillForm skill={skill} agents={agents} systems={systems} />
    </div>
  );
}
