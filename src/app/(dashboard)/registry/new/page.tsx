import { PageHeader } from "@/components/layout/page-header";
import { AISystemForm } from "@/components/forms/ai-system-form";

export default function NewSystemPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Register AI System"
        description="Add a new AI system to the governance registry"
      />
      <AISystemForm />
    </div>
  );
}
