import Link from "next/link";
import { Scale, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HelpHint } from "@/components/help/help-hint";
import {
  ANNEX_III_CATEGORIES,
  ROLE_LABELS,
  TIER_LABELS,
  describeDeadline,
  tierBadgeVariant,
  type EuAiActRole,
  type EuAiActTier,
} from "@/lib/eu-ai-act";
import { formatDate } from "@/lib/utils";

export type EuAiActCardClassification = {
  tier: EuAiActTier;
  role: EuAiActRole;
  annexIProduct: boolean;
  annexIiiCategories: string[];
  derogationClaimed: boolean;
  transparencyRequired: boolean;
  friaRequired: boolean;
  gpaiDeployer: boolean;
  gpaiProvider: boolean;
  applicableArticles: string[];
  obligationDeadline: Date | string | null;
  classifiedAt: Date | string;
  reviewDueAt: Date | string | null;
  classifiedByUser: { name: string | null; email: string };
};

export function EuAiActCard({
  systemId,
  classification,
  obligationSummary,
}: {
  systemId: string;
  classification: EuAiActCardClassification | null;
  /** Assessed vs total applicable articles, from the framework coverage rows. */
  obligationSummary?: { total: number; satisfied: number; unassessed: number };
}) {
  const wizardHref = `/registry/${systemId}/eu-ai-act`;

  if (!classification) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-[var(--accent)]" />
            EU AI Act Classification
            <HelpHint hint="eu_ai_act_classification" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-[var(--text-secondary)]">
            Not yet classified. A short questionnaire determines whether this system is prohibited,
            high-risk, subject to transparency duties, or minimal risk under Regulation (EU) 2024/1689,
            and which articles you must evidence.
          </p>
          <Link href={wizardHref}>
            <Button size="sm">
              Run classification <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const c = classification;
  const flags: string[] = [];
  if (c.annexIProduct) flags.push("Annex I product");
  for (const id of c.annexIiiCategories) {
    flags.push(ANNEX_III_CATEGORIES.find((o) => o.id === id)?.label ?? id);
  }
  if (c.derogationClaimed) flags.push("Art. 6(3) derogation claimed");
  if (c.friaRequired) flags.push("FRIA required (Art. 27)");
  if (c.transparencyRequired) flags.push("Transparency duties (Art. 50)");
  if (c.gpaiProvider) flags.push("GPAI provider");
  else if (c.gpaiDeployer) flags.push("Built on a GPAI model");

  const deadline = c.obligationDeadline
    ? describeDeadline({
        date: new Date(c.obligationDeadline).toISOString().slice(0, 10),
        label:
          c.tier === "PROHIBITED"
            ? "Prohibitions"
            : c.tier === "HIGH_RISK"
              ? c.annexIProduct
                ? "Annex I high-risk obligations"
                : "Annex III high-risk obligations"
              : c.tier === "LIMITED_RISK"
                ? "Transparency obligations"
                : "AI literacy duty",
      })
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-[var(--accent)]" />
            EU AI Act Classification
            <HelpHint hint="eu_ai_act_classification" />
          </span>
          <Badge variant={tierBadgeVariant(c.tier)}>{TIER_LABELS[c.tier]}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--text-muted)]">Our role</dt>
            <dd className="font-medium text-right">{ROLE_LABELS[c.role]}</dd>
          </div>
          {deadline && (
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--text-muted)]">Timeline</dt>
              <dd className="font-medium text-right">{deadline}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--text-muted)]">Applicable articles</dt>
            <dd className="font-medium text-right">
              <Link
                href={`/registry/${systemId}?tab=compliance&framework=EU_AI_ACT`}
                className="text-[var(--accent)] hover:underline"
              >
                {c.applicableArticles.length} article{c.applicableArticles.length === 1 ? "" : "s"}
                {obligationSummary
                  ? ` · ${obligationSummary.satisfied} satisfied · ${obligationSummary.unassessed} unassessed`
                  : ""}
              </Link>
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--text-muted)]">Classified</dt>
            <dd className="font-medium text-right">
              {formatDate(c.classifiedAt)} by {c.classifiedByUser.name ?? c.classifiedByUser.email}
            </dd>
          </div>
          {c.reviewDueAt && (
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--text-muted)]">Re-classify by</dt>
              <dd className="font-medium text-right">{formatDate(c.reviewDueAt)}</dd>
            </div>
          )}
        </dl>

        {flags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {flags.map((flag) => (
              <span
                key={flag}
                className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]"
              >
                {flag}
              </span>
            ))}
          </div>
        )}

        {c.tier === "PROHIBITED" && (
          <p className="rounded-md border border-[var(--critical-border)] bg-[var(--critical-dim)] px-3 py-2 text-xs text-[var(--critical-strong)]">
            A prohibited practice was identified. This system cannot be approved until the practice is
            removed and the classification is re-run.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Link href={wizardHref}>
            <Button size="sm" variant="outline">
              Update classification
            </Button>
          </Link>
          <Link href={`/registry/${systemId}?tab=compliance&framework=EU_AI_ACT`}>
            <Button size="sm" variant="ghost">
              Assess obligations <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
