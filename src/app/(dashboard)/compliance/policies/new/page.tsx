import { PageHeader } from "@/components/layout/page-header";
import { PolicyForm } from "@/components/forms/policy-form";

export default function NewPolicyPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Create Policy" description="Define a new compliance policy" />
      <PolicyForm />
    </div>
  );
}
