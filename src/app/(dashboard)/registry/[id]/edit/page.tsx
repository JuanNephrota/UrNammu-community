import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { AISystemForm } from "@/components/forms/ai-system-form";

export default async function EditSystemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const system = await prisma.aISystem.findUnique({ where: { id } });
  if (!system) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit: ${system.name}`}
        description="Update AI system details"
      />
      <AISystemForm initialData={system} />
    </div>
  );
}
