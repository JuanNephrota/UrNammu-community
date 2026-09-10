import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  KeyUsageRulesManager,
  type KeyUsageRule,
} from "./key-usage-rules-manager";

export default async function KeyUsageRulesPage() {
  const rules = await prisma.keyUsageRule.findMany({
    orderBy: [{ builtIn: "desc" }, { key: "asc" }],
  });

  const serialized: KeyUsageRule[] = rules.map((rule) => ({
    id: rule.id,
    key: rule.key,
    label: rule.label,
    description: rule.description,
    conditionType: rule.conditionType,
    severity: rule.severity,
    providers: rule.providers,
    apiKeyExternalIds: rule.apiKeyExternalIds,
    config: (rule.config ?? {}) as Record<string, unknown>,
    enabled: rule.enabled,
    builtIn: rule.builtIn,
  }));

  const enabledCount = rules.filter((rule) => rule.enabled).length;

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
          title="Key Usage Rules"
          description={`${enabledCount} of ${rules.length} rule${rules.length !== 1 ? "s" : ""} active. Flag anomalous API key usage and raise alerts.`}
        />
      </div>

      <KeyUsageRulesManager initialRules={serialized} />
    </div>
  );
}
