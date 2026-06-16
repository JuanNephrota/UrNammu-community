import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { PolicyForm } from "@/components/forms/policy-form";
import { parsePolicyRules } from "@/lib/policy-rules";

export default async function EditPolicyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const policy = await prisma.policy.findUnique({ where: { id } });
  if (!policy) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit ${policy.name}`}
        description="Update policy details, rules, and enforcement behavior"
      />
      <PolicyForm
        initialData={{
          id: policy.id,
          name: policy.name,
          description: policy.description,
          framework: policy.framework,
          version: policy.version,
          content: policy.content,
          status: policy.status,
          rules: parsePolicyRules(policy.rules),
        }}
      />
    </div>
  );
}
