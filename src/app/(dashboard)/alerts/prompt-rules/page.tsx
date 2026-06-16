import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { HelpHint } from "@/components/help/help-hint";
import { PromptRulesManager } from "./prompt-rules-manager";

export default async function PromptRiskRulesPage() {
  const rules = await prisma.promptRiskRule.findMany({
    orderBy: [{ builtIn: "desc" }, { key: "asc" }],
  });

  const serialized = rules.map((r) => ({
    id: r.id,
    key: r.key,
    label: r.label,
    severity: r.severity,
    patterns: r.patterns,
    description: r.description,
    enabled: r.enabled,
    builtIn: r.builtIn,
  }));

  const enabledCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/alerts"
          className="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <PageHeader
          title="Prompt Risk Rules"
          description={`${enabledCount} of ${rules.length} rule${rules.length !== 1 ? "s" : ""} active. Tune detection for your environment.`}
        >
          <HelpHint hint="prompt_risk_rules" />
        </PageHeader>
      </div>

      <PromptRulesManager initialRules={serialized} />
    </div>
  );
}
